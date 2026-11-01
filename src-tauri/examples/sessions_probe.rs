//! Lists Windows audio endpoints and the app sessions on the ones Mixdeck maps to Voicemeeter
//! strips/buses, so the endpoint → strip/bus table can be checked on a real PC.
//! Read-only unless `--mute`/`--unmute`/`--volume` is given. Never launches Voicemeeter.
//!
//! ```text
//! cargo run --manifest-path src-tauri/Cargo.toml --example sessions_probe
//!     [-- --system]                 include the "System sounds" session
//!     [-- --mute <name>]            mute sessions whose app name contains <name> (case-insensitive)
//!     [-- --unmute <name>]
//!     [-- --volume <name> <0..1>]
//!     [-- --peaks]                  sample peaks for 3 s
//! ```

use std::process::ExitCode;
use std::time::{Duration, Instant};

use mixdeck_lib::sessions::coreaudio::{ComGuard, CoreAudio};
use mixdeck_lib::sessions::mapping::{EndpointState, Mapping, TARGETS};
use mixdeck_lib::sessions::types::SessionTargetKind;
use mixdeck_lib::sessions::worker::{ScanOptions, SessionsBackend};

fn target_label(kind: SessionTargetKind, index: u8) -> String {
    match kind {
        SessionTargetKind::Strip => format!("strip {index} (V IN {})", index - 4),
        SessionTargetKind::Bus => format!("bus {index} (B{})", index - 4),
    }
}

enum Action {
    Mute(String, bool),
    Volume(String, f32),
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut show_system = false;
    let mut peaks = false;
    let mut action = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--system" => show_system = true,
            "--peaks" => peaks = true,
            "--mute" | "--unmute" if i + 1 < args.len() => {
                action = Some(Action::Mute(
                    args[i + 1].to_lowercase(),
                    args[i] == "--mute",
                ));
                i += 1;
            }
            "--volume" if i + 2 < args.len() => {
                let Ok(v) = args[i + 2].parse::<f32>() else {
                    eprintln!("--volume needs a number 0..1");
                    return ExitCode::from(2);
                };
                action = Some(Action::Volume(args[i + 1].to_lowercase(), v));
                i += 2;
            }
            other => {
                eprintln!("unknown argument: {other} (see the file header for usage)");
                return ExitCode::from(2);
            }
        }
        i += 1;
    }

    let _com = match ComGuard::init_mta() {
        Ok(g) => g,
        Err(e) => {
            eprintln!("COM init failed: {e}");
            return ExitCode::FAILURE;
        }
    };
    let mut ca = match CoreAudio::new() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Core Audio unavailable: {e}");
            return ExitCode::FAILURE;
        }
    };

    // 1. Every endpoint, any state.
    let all = match ca.endpoints(false) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("couldn't enumerate endpoints: {e}");
            return ExitCode::FAILURE;
        }
    };
    let mapping = Mapping::default();
    println!("== Endpoints ({}) ==", all.len());
    println!(
        "{:<8} {:<11} {:<34} {:<38} maps to",
        "flow", "state", "endpoint name", "interface name"
    );
    let (mut rows, unnamed): (Vec<_>, Vec<_>) = all
        .iter()
        .map(|(e, _)| e)
        .partition(|e| !(e.name.is_empty() && e.interface.is_empty()));
    rows.sort_by_key(|e| {
        (
            e.flow.label(),
            e.state != EndpointState::Active,
            e.name.to_lowercase(),
        )
    });
    for e in rows {
        let maps = match mapping.target_for(e) {
            Some(t) if e.state == EndpointState::Active => target_label(t.kind, t.index),
            Some(t) => format!("({}, inactive)", target_label(t.kind, t.index)),
            None => "-".into(),
        };
        println!(
            "{:<8} {:<11} {:<34} {:<38} {maps}",
            e.flow.label(),
            e.state.label(),
            e.name,
            e.interface
        );
    }
    if !unnamed.is_empty() {
        println!(
            "({} endpoints with no name or interface not shown)",
            unnamed.len()
        );
    }

    // 2. Mapping result + raw sessions on each mapped endpoint.
    let active: Vec<_> = all
        .iter()
        .filter(|(e, _)| e.state == EndpointState::Active)
        .collect();
    let infos: Vec<_> = active.iter().map(|(e, _)| e.clone()).collect();
    let opts = ScanOptions { show_system };
    println!("\n== Mapping and sessions ==");
    let t0 = Instant::now();
    let mut keys = Vec::new();
    for (target, hit) in mapping.resolve(&infos) {
        let label = target_label(target.kind, target.index);
        let Some(info) = hit else {
            println!(
                "{label}: NOT FOUND (expected an active endpoint named \"{}\")",
                mapping.endpoint_for(target).unwrap_or("?")
            );
            continue;
        };
        println!("{label}: {} [{}]", info.name, info.interface);
        let Some((_, dev)) = active.iter().find(|(e, _)| e.id == info.id) else {
            continue;
        };
        match ca.probe_sessions(dev, &opts) {
            Ok(list) if list.is_empty() => println!("    (no sessions)"),
            Ok(list) => {
                for s in list {
                    let a = &s.app;
                    println!(
                        "    {:<28} pid {:<6} {:<8} vol {:>3.0}% {:<5} peak {:<6} key {} icon {}{}",
                        a.name,
                        a.pid,
                        s.state,
                        a.volume * 100.0,
                        if a.muted { "MUTED" } else { "" },
                        s.peak.map(|p| format!("{p:.3}")).unwrap_or("-".into()),
                        a.key,
                        a.icon
                            .as_ref()
                            .map(|i| format!("{} B", i.len()))
                            .unwrap_or("none".into()),
                        if s.display_name.is_empty() {
                            String::new()
                        } else {
                            format!("  display \"{}\"", s.display_name)
                        },
                    );
                    println!(
                        "    {:<28} exe {}",
                        "",
                        a.exe.as_deref().unwrap_or("(not readable)")
                    );
                    keys.push((a.name.to_lowercase(), a.key.clone()));
                }
            }
            Err(e) => println!("    sessions error: {e}"),
        }
    }
    println!(
        "(scan took {:?}, {} icons cached)",
        t0.elapsed(),
        ca.icon_cache_len()
    );
    let unmatched: Vec<_> = TARGETS
        .iter()
        .filter(|t| mapping.endpoint_for(**t).is_none())
        .collect();
    if !unmatched.is_empty() {
        println!("targets without a rule: {unmatched:?}");
    }

    // 3. Optional write, through the same code path as `set_app_mute` / `set_app_volume`.
    if let Some(action) = action {
        let (needle, what) = match &action {
            Action::Mute(n, m) => (n.clone(), if *m { "mute" } else { "unmute" }.to_owned()),
            Action::Volume(n, v) => (n.clone(), format!("volume {v}")),
        };
        let hits: Vec<_> = keys.iter().filter(|(n, _)| n.contains(&needle)).collect();
        if hits.is_empty() {
            eprintln!("\nno session name contains \"{needle}\"");
            return ExitCode::FAILURE;
        }
        for (name, key) in hits {
            let r = match &action {
                Action::Mute(_, m) => ca.set_mute(key, *m),
                Action::Volume(_, v) => ca.set_volume(key, v.clamp(0.0, 1.0)),
            };
            match r {
                Ok(()) => println!("\n{what}: {name} ({key}) ok — check the Windows volume mixer"),
                Err(e) => println!("\n{what}: {name} ({key}) failed: {e}"),
            }
        }
    }

    // 4. Optional peak sampling (needs a full scan so the backend holds the meters).
    if peaks {
        if let Err(e) = ca.scan(&mapping, &opts) {
            eprintln!("scan failed: {e}");
            return ExitCode::FAILURE;
        }
        println!("\n== Peaks (3 s, max per app) ==");
        let mut max: Vec<(String, f32)> = Vec::new();
        let mut buf = Vec::new();
        let end = Instant::now() + Duration::from_secs(3);
        while Instant::now() < end {
            ca.peaks(&mut buf);
            for (k, p) in &buf {
                match max.iter_mut().find(|(mk, _)| mk == k) {
                    Some(m) => m.1 = m.1.max(*p),
                    None => max.push((k.clone(), *p)),
                }
            }
            std::thread::sleep(Duration::from_millis(66));
        }
        for (k, p) in max {
            let name = keys
                .iter()
                .find(|(_, kk)| *kk == k)
                .map(|(n, _)| n.as_str())
                .unwrap_or("?");
            println!("    {name:<28} {p:.3}");
        }
    }
    ExitCode::SUCCESS
}
