//! vmr_probe: checks the `vmr` wrapper against the real Voicemeeter install.
//!
//! ```text
//! cargo run --manifest-path src-tauri/Cargo.toml --example vmr_probe [-- OPTIONS]
//!
//!   (no options)            full probe: DLL path + file version + exports, VM type/version,
//!                           8 strip labels/gains, 10 input level samples, device lists
//!   --version-check         only read the DLL file (version + export table); never loads it
//!   --get <param>           read one parameter (float, falling back to string)
//!   --set <param> <value>   write one parameter (number → float, otherwise string)
//!   --set-string <param> <value>   force a string write
//!   --fx-check              read every Strip FX param on all 8 strips (read only) and report
//!                           which exist per strip type (UnknownParam = not on that strip)
//!   --script <text>         apply a SetParameters script, e.g. "Strip[0].Mute = 1; Strip[0].Mute = 0"
//!   --dll <path>            use this DLL instead of the registry/fallback lookup
//! ```
//! Never launches Voicemeeter. Read-only on the install folder.

use std::path::PathBuf;
use std::process::ExitCode;
use std::time::{Duration, Instant};

use mixdeck_lib::vmr::{
    self, LevelKind, LoginStatus, TARGET_VM_VERSION, VmrClient, VmrError, compare_exports, ffi,
    inspect_dll, layout, params,
};

enum Mode {
    Full,
    VersionCheck,
    Get(String),
    Set {
        name: String,
        value: String,
        force_string: bool,
    },
    Script(String),
    FxCheck,
}

fn usage() -> ExitCode {
    eprintln!(
        "usage: vmr_probe [--dll <path>] [--version-check | --get <param> | --set <param> <value> | \
         --set-string <param> <value> | --script <text> | --fx-check]"
    );
    ExitCode::from(2)
}

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    let mut mode = Mode::Full;
    let mut dll: Option<PathBuf> = None;
    while let Some(a) = args.next() {
        match a.as_str() {
            "--dll" => match args.next() {
                Some(p) => dll = Some(PathBuf::from(p)),
                None => return usage(),
            },
            "--version-check" => mode = Mode::VersionCheck,
            "--fx-check" => mode = Mode::FxCheck,
            "--get" => match args.next() {
                Some(n) => mode = Mode::Get(n),
                None => return usage(),
            },
            "--set" | "--set-string" => match (args.next(), args.next()) {
                (Some(name), Some(value)) => {
                    mode = Mode::Set {
                        name,
                        value,
                        force_string: a == "--set-string",
                    }
                }
                _ => return usage(),
            },
            "--script" => match args.next() {
                Some(s) => mode = Mode::Script(s),
                None => return usage(),
            },
            "-h" | "--help" => {
                usage();
                return ExitCode::SUCCESS;
            }
            _ => return usage(),
        }
    }

    let path = match dll {
        Some(p) => {
            println!("DLL path      : {} (from --dll)", p.display());
            p
        }
        None => match vmr::locate_dll_detailed() {
            Ok(l) => {
                println!("DLL path      : {} (via {:?})", l.path.display(), l.source);
                l.path
            }
            Err(e) => {
                eprintln!("error: {e}");
                return ExitCode::FAILURE;
            }
        },
    };

    if matches!(mode, Mode::Full | Mode::VersionCheck) {
        version_check(&path);
        if matches!(mode, Mode::VersionCheck) {
            return ExitCode::SUCCESS;
        }
    }

    let mut client = match VmrClient::load(&path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("error: {e}");
            return ExitCode::FAILURE;
        }
    };
    for (name, present) in client.optional_symbols() {
        println!(
            "optional      : {name} {}",
            if present { "present" } else { "MISSING" }
        );
    }

    let status = match client.login() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("error: {e}");
            return ExitCode::FAILURE;
        }
    };
    if status == LoginStatus::NotRunning {
        println!(
            "Voicemeeter   : not running (logged in; start Voicemeeter and run the probe again)"
        );
        if matches!(mode, Mode::Full) {
            print_devices(&client);
        }
        client.logout();
        return if matches!(mode, Mode::Full) {
            ExitCode::SUCCESS
        } else {
            ExitCode::FAILURE
        };
    }
    // The SDK example polls IsParametersDirty right after login so the first reads are fresh.
    settle(&client);

    let code = match mode {
        Mode::Full => full(&client),
        Mode::Get(name) => get(&client, &name),
        Mode::FxCheck => fx_check(&client),
        Mode::Set {
            name,
            value,
            force_string,
        } => set(&client, &name, &value, force_string),
        Mode::Script(s) => match client.set_script(&s) {
            Ok(()) => {
                // SetParameters is applied asynchronously; logging out straight away can drop
                // it (seen on 3.1.3.0). Let the engine pick it up before Logout.
                std::thread::sleep(Duration::from_millis(300));
                settle(&client);
                println!("script        : applied ({} bytes)", s.len());
                ExitCode::SUCCESS
            }
            Err(e) => fail(e),
        },
        Mode::VersionCheck => ExitCode::SUCCESS,
    };
    client.logout();
    code
}

fn fail(e: VmrError) -> ExitCode {
    eprintln!("error: {e}");
    ExitCode::FAILURE
}

/// Polls `is_dirty` until it settles (or 1 s), so cached parameter values are current.
fn settle(client: &VmrClient) {
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(1) {
        match client.is_dirty() {
            Ok(false) => break,
            Ok(true) => {}
            Err(e) => {
                println!("is_dirty      : {e}");
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn version_check(path: &std::path::Path) {
    let info = match inspect_dll(path) {
        Ok(i) => i,
        Err(e) => {
            println!("version check : {e}");
            return;
        }
    };
    println!(
        "DLL file ver  : {} (product {}){}",
        info.file_version_string()
            .unwrap_or_else(|| "unknown".into()),
        info.product_version
            .map(vmr::pe::fmt_version)
            .unwrap_or_else(|| "unknown".into()),
        if info.is_x64 { ", x64" } else { ", NOT x64" }
    );
    println!("DLL exports   : {} total", info.exports.len());
    for e in &info.exports {
        let tag = if ffi::REQUIRED.contains(&e.as_str()) {
            "required"
        } else if ffi::OPTIONAL.contains(&e.as_str()) {
            "optional"
        } else if ffi::HEADER_EXPORTS.contains(&e.as_str()) {
            "in header"
        } else if ffi::HEADER_INTERNAL.contains(&e.as_str()) {
            "internal"
        } else {
            "NOT IN HEADER"
        };
        println!("  {e:<34} {tag}");
    }
    let missing_required: Vec<_> = ffi::REQUIRED
        .iter()
        .filter(|r| !info.exports.iter().any(|e| e == *r))
        .collect();
    let report = compare_exports(&info.exports);
    println!(
        "required      : {}",
        if missing_required.is_empty() {
            "all present".to_string()
        } else {
            format!("MISSING {missing_required:?}")
        }
    );
    println!(
        "header vs DLL : missing from DLL {:?}; not in header {:?}",
        report.missing_from_dll, report.not_in_header
    );
}

fn full(client: &VmrClient) -> ExitCode {
    match client.vm_type() {
        Ok(t) => println!("VM type       : {}", t.name()),
        Err(e) => println!("VM type       : error: {e}"),
    }
    match client.vm_version_parts() {
        Ok(p) => {
            let v = vmr::format_version(p);
            if p < TARGET_VM_VERSION {
                println!(
                    "VM version    : {v} (older than target {})",
                    vmr::format_version(TARGET_VM_VERSION)
                );
            } else {
                println!("VM version    : {v}");
            }
        }
        Err(e) => println!("VM version    : error: {e}"),
    }

    println!("\nStrips:");
    for i in 0..layout::STRIPS {
        let s = params::strip(i);
        let label = client
            .get_string(&s.label())
            .unwrap_or_else(|e| format!("<{e}>"));
        let gain = client
            .get_float(&s.gain())
            .map(|g| format!("{g:+.1} dB"))
            .unwrap_or_else(|e| format!("<{e}>"));
        let label = if label.is_empty() {
            format!("({})", layout::STRIP_DEFAULT_NAMES[i])
        } else {
            label
        };
        println!("  [{i}] {label:<28} gain {gain}");
    }

    println!(
        "\nInput levels (post-fader, first channel of each strip, dBFS), 10 samples @ 100 ms:"
    );
    for n in 0..10 {
        let mut row = String::new();
        for i in 0..layout::STRIPS {
            let ch = layout::strip_level_channels(i).start;
            match client.get_level(LevelKind::PostFader, ch) {
                Ok(v) => row.push_str(&format!("{:>7.1}", layout::level_to_db(v, -60.0))),
                Err(e) => row.push_str(&format!(" <{e}>")),
            }
        }
        println!("  #{n:<2}{row}");
        std::thread::sleep(Duration::from_millis(100));
    }

    print_devices(client);
    ExitCode::SUCCESS
}

fn print_devices(client: &VmrClient) {
    for (title, list) in [
        ("Input devices", client.input_devices()),
        ("Output devices", client.output_devices()),
    ] {
        match list {
            Ok(devs) => {
                println!("\n{title} ({}):", devs.len());
                for d in devs {
                    println!("  {:<5} {}  [{}]", d.kind.label(), d.name, d.hwid);
                }
            }
            Err(e) => println!("\n{title}: error: {e}"),
        }
    }
}

fn get(client: &VmrClient, name: &str) -> ExitCode {
    match client.get_float(name) {
        Ok(v) => {
            println!("{name} = {v}");
            return ExitCode::SUCCESS;
        }
        Err(VmrError::NoServer) => return fail(VmrError::NoServer),
        Err(e) => match client.get_string(name) {
            Ok(s) => println!("{name} = \"{s}\""),
            Err(e2) => {
                eprintln!("float read: {e}");
                return fail(e2);
            }
        },
    }
    ExitCode::SUCCESS
}

fn set(client: &VmrClient, name: &str, value: &str, force_string: bool) -> ExitCode {
    let result = match value.parse::<f32>() {
        Ok(v) if !force_string => client.set_float(name, v),
        _ => client.set_string(name, value),
    };
    if let Err(e) = result {
        return fail(e);
    }
    println!("set           : {name} <- {value}");
    // Voicemeeter applies writes asynchronously; wait for the change to show up, then read back.
    std::thread::sleep(Duration::from_millis(150));
    settle(client);
    get(client, name)
}

/// Reads every Strip FX parameter on every strip (no writes) and prints a per-strip table:
/// the value when it exists, `—` when Voicemeeter answers `UnknownParam`.
fn fx_check(client: &VmrClient) -> ExitCode {
    type Name = fn(&params::Strip) -> String;
    let scalar: [(&str, Name); 24] = [
        ("Limit", |s| s.limit()),
        ("Denoiser", |s| s.denoiser()),
        ("Comp", |s| s.comp()),
        ("Comp.GainIn", |s| s.comp_gain_in()),
        ("Comp.Ratio", |s| s.comp_ratio()),
        ("Comp.Threshold", |s| s.comp_threshold()),
        ("Comp.Attack", |s| s.comp_attack()),
        ("Comp.Release", |s| s.comp_release()),
        ("Comp.Knee", |s| s.comp_knee()),
        ("Comp.GainOut", |s| s.comp_gain_out()),
        ("Comp.MakeUp", |s| s.comp_makeup()),
        ("Gate", |s| s.gate()),
        ("Gate.Threshold", |s| s.gate_threshold()),
        ("Gate.Damping", |s| s.gate_damping()),
        ("Gate.BPSidechain", |s| s.gate_bp_sidechain()),
        ("Gate.Attack", |s| s.gate_attack()),
        ("Gate.Hold", |s| s.gate_hold()),
        ("Gate.Release", |s| s.gate_release()),
        ("EQ.on", |s| s.eq_on()),
        ("EQ.AB", |s| s.eq_ab()),
        ("EQGain1", |s| s.eq_gain(1)),
        ("EQGain2", |s| s.eq_gain(2)),
        ("EQGain3", |s| s.eq_gain(3)),
        ("EQ.ch0.cell0.f", |s| s.eq_cell(0, 0, params::EqField::F)),
    ];
    print!("{:<18}", "param");
    for i in 0..layout::STRIPS {
        print!(
            "{:>10}",
            format!(
                "S{i}{}",
                if layout::is_hardware_strip(i) {
                    "hw"
                } else {
                    "v"
                }
            )
        );
    }
    println!();
    let cell = |r: Result<f32, VmrError>| match r {
        Ok(v) => format!("{v:.2}"),
        Err(VmrError::UnknownParam(_)) => "—".to_string(),
        Err(e) => format!("err:{}", e.to_string().chars().take(5).collect::<String>()),
    };
    for (label, f) in scalar {
        print!("{label:<18}");
        for i in 0..layout::STRIPS {
            print!("{:>10}", cell(client.get_float(&f(&params::strip(i)))));
        }
        println!();
    }
    // Full EQ cell grid: count how many of the 8×6×5 names exist per strip.
    print!("{:<18}", "EQ cells ok/240");
    for i in 0..layout::STRIPS {
        let s = params::strip(i);
        let mut ok = 0;
        for ch in 0..8 {
            for k in 0..6 {
                for fld in params::EqField::ALL {
                    if client.get_float(&s.eq_cell(ch, k, fld)).is_ok() {
                        ok += 1;
                    }
                }
            }
        }
        print!("{ok:>10}");
    }
    println!();
    ExitCode::SUCCESS
}
