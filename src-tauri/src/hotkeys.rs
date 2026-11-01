//! Global hotkeys, through `tauri-plugin-global-shortcut`. They act in Rust, so they
//! work while the window is hidden, and show a toast when it's visible.
//!
//! The bindings come from `Settings.hotkeys`. [`apply`] re-registers all of them whenever they
//! change and records a per-binding [`HotkeyStatus`] (registered, invalid, duplicate, or refused
//! by Windows because another app owns the combination). While the Settings recorder listens
//! for a new combination, [`set_paused`] unregisters everything so pressing an existing
//! hotkey records it instead of firing it.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};
use ts_rs::TS;

use crate::engine::state::ParamValue;
use crate::engine::{Command, Engine};
use crate::notify::{self, Notice, NoticeKind};
use crate::settings::{Hotkey, SettingsState};
use crate::vmr::layout::{self, BUSES, STRIPS};
use crate::vmr::params;
use crate::{presets, window};

/// Gain limits (dB), same as the Mixer faders.
const GAIN_MIN: f32 = -60.0;
const GAIN_MAX: f32 = 12.0;
/// A locally written value is trusted over the engine snapshot for this long (the snapshot
/// lags a tick behind, so fast repeated presses would otherwise step from a stale value).
const PENDING: Duration = Duration::from_millis(800);
pub const MAX_HOTKEYS: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub enum TargetKind {
    Strip,
    Bus,
}

/// A strip (0–7) or bus (0–7, A1…B3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct Target {
    pub kind: TargetKind,
    pub index: u8,
}

impl Target {
    fn valid(&self) -> bool {
        let max = match self.kind {
            TargetKind::Strip => STRIPS,
            TargetKind::Bus => BUSES,
        };
        (self.index as usize) < max
    }
    fn mute(&self) -> String {
        match self.kind {
            TargetKind::Strip => params::strip(self.index as usize).mute(),
            TargetKind::Bus => params::bus(self.index as usize).mute(),
        }
    }
    fn gain(&self) -> String {
        match self.kind {
            TargetKind::Strip => params::strip(self.index as usize).gain(),
            TargetKind::Bus => params::bus(self.index as usize).gain(),
        }
    }
}

/// What a hotkey does.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub enum HotkeyAction {
    ToggleWindow,
    ToggleMute {
        target: Target,
    },
    /// `delta` in dB, non-zero, within ±12.
    Gain {
        target: Target,
        delta: f32,
    },
    LoadPreset {
        id: String,
    },
}

impl HotkeyAction {
    pub fn validate(&self) -> Result<(), String> {
        match self {
            HotkeyAction::ToggleWindow => Ok(()),
            HotkeyAction::ToggleMute { target } if target.valid() => Ok(()),
            HotkeyAction::Gain { target, delta }
                if target.valid() && delta.is_finite() && *delta != 0.0 && delta.abs() <= 12.0 =>
            {
                Ok(())
            }
            HotkeyAction::Gain { .. } => Err(
                "A gain hotkey needs a valid strip or bus and a step between ±0.1 and ±12 dB."
                    .into(),
            ),
            HotkeyAction::LoadPreset { id } if !id.trim().is_empty() => Ok(()),
            HotkeyAction::LoadPreset { .. } => Err("Choose a preset for this hotkey.".into()),
            HotkeyAction::ToggleMute { .. } => Err("Choose a valid strip or bus.".into()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub enum HotkeyRegState {
    /// Active.
    Registered,
    /// No key combination recorded yet.
    Unset,
    /// The accelerator couldn't be parsed.
    Invalid,
    /// An earlier binding in the list uses the same combination.
    Duplicate,
    /// Windows refused it (usually another app owns the combination).
    Failed,
    /// Temporarily off while the recorder listens.
    Paused,
}

/// Registration result for `Settings.hotkeys[i]` (same order).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct HotkeyStatus {
    pub accelerator: String,
    pub state: HotkeyRegState,
    pub message: Option<String>,
}

#[derive(Default)]
struct Inner {
    bindings: HashMap<u32, HotkeyAction>,
    status: Vec<HotkeyStatus>,
    paused: bool,
    pending: HashMap<String, (f32, Instant)>,
}

#[derive(Default)]
pub struct HotkeysState(Mutex<Inner>);

fn friendly(err: &str) -> String {
    let lower = err.to_lowercase();
    if lower.contains("already registered") || lower.contains("1409") {
        "Another app is already using this shortcut. Pick a different one.".into()
    } else {
        format!("Windows refused this shortcut: {err}")
    }
}

/// Parses an accelerator like `"Control+Shift+KeyM"`.
pub fn parse(accelerator: &str) -> Result<Shortcut, String> {
    let s: Shortcut = accelerator
        .parse()
        .map_err(|e| format!("“{accelerator}” isn't a valid shortcut ({e})."))?;
    if s.mods.is_empty() && !is_function_key(accelerator) {
        return Err(
            "Add Ctrl, Alt, Shift or Win, so the shortcut doesn't block normal typing.".into(),
        );
    }
    Ok(s)
}

fn is_function_key(accelerator: &str) -> bool {
    let key = accelerator.rsplit('+').next().unwrap_or("").to_uppercase();
    key.strip_prefix('F')
        .and_then(|n| n.parse::<u8>().ok())
        .is_some_and(|n| (1..=24).contains(&n))
}

/// Registers `hotkeys` (replacing whatever was registered) and returns their status.
pub fn apply(app: &AppHandle, hotkeys: &[Hotkey]) -> Vec<HotkeyStatus> {
    // The plugin runs (un)registration on the main thread, which is also where shortcut
    // events arrive, so never hold our lock across those calls.
    let state = app.state::<HotkeysState>();
    let paused = state.0.lock().map(|i| i.paused).unwrap_or(false);
    let gs = app.global_shortcut();
    if let Err(e) = gs.unregister_all() {
        log::warn!("hotkeys: couldn't unregister: {e}");
    }
    let mut bindings = HashMap::new();
    let mut status = Vec::with_capacity(hotkeys.len());
    let mut seen: HashMap<u32, usize> = HashMap::new();
    for (i, hk) in hotkeys.iter().enumerate() {
        let st = |state, message: Option<String>| HotkeyStatus {
            accelerator: hk.accelerator.clone(),
            state,
            message,
        };
        if hk.accelerator.trim().is_empty() {
            status.push(st(HotkeyRegState::Unset, None));
            continue;
        }
        let shortcut = match parse(&hk.accelerator) {
            Ok(s) => s,
            Err(e) => {
                status.push(st(HotkeyRegState::Invalid, Some(e)));
                continue;
            }
        };
        if let Some(first) = seen.get(&shortcut.id()) {
            status.push(st(
                HotkeyRegState::Duplicate,
                Some(format!("Hotkey {} already uses this shortcut.", first + 1)),
            ));
            continue;
        }
        seen.insert(shortcut.id(), i);
        if paused {
            bindings.insert(shortcut.id(), hk.action.clone());
            status.push(st(HotkeyRegState::Paused, None));
            continue;
        }
        match gs.register(shortcut) {
            Ok(()) => {
                bindings.insert(shortcut.id(), hk.action.clone());
                status.push(st(HotkeyRegState::Registered, None));
            }
            Err(e) => {
                log::warn!("hotkeys: couldn't register `{}`: {e}", hk.accelerator);
                status.push(st(HotkeyRegState::Failed, Some(friendly(&e.to_string()))));
            }
        }
    }
    let ok = status
        .iter()
        .filter(|s| s.state == HotkeyRegState::Registered)
        .count();
    log::info!("hotkeys: {ok} of {} registered", hotkeys.len());
    if let Ok(mut inner) = state.0.lock() {
        inner.bindings = bindings;
        inner.status = status.clone();
    }
    status
}

fn current_hotkeys(app: &AppHandle) -> Vec<Hotkey> {
    app.state::<SettingsState>()
        .get()
        .map(|s| s.hotkeys)
        .unwrap_or_default()
}

/// Registers the saved hotkeys. Call from `setup`, after settings load.
pub fn init(app: &AppHandle) {
    apply(app, &current_hotkeys(app));
}

pub fn status(app: &AppHandle) -> Vec<HotkeyStatus> {
    app.state::<HotkeysState>()
        .0
        .lock()
        .map(|i| i.status.clone())
        .unwrap_or_default()
}

/// Turns all hotkeys off (true) or back on (false) while the recorder listens.
pub fn set_paused(app: &AppHandle, paused: bool) -> Vec<HotkeyStatus> {
    if let Ok(mut inner) = app.state::<HotkeysState>().0.lock() {
        if inner.paused == paused {
            return inner.status.clone();
        }
        inner.paused = paused;
    }
    apply(app, &current_hotkeys(app))
}

/// Checks that `accelerator` parses and that Windows would accept it right now. Returns the
/// canonical form. Our own active bindings count as available (the UI flags duplicates).
pub fn check(app: &AppHandle, accelerator: &str) -> Result<String, String> {
    let shortcut = parse(accelerator)?;
    let ours = app
        .state::<HotkeysState>()
        .0
        .lock()
        .map(|i| i.bindings.contains_key(&shortcut.id()))
        .unwrap_or(false);
    let gs = app.global_shortcut();
    if !ours || !gs.is_registered(shortcut) {
        gs.register(shortcut)
            .map_err(|e| friendly(&e.to_string()))?;
        if let Err(e) = gs.unregister(shortcut) {
            log::warn!("hotkeys: couldn't release test shortcut: {e}");
        }
    }
    Ok(shortcut.into_string())
}

/// The plugin's handler (registered in `lib.rs`).
pub fn on_shortcut(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    let action = app.state::<HotkeysState>().0.lock().ok().and_then(|i| {
        (!i.paused)
            .then(|| i.bindings.get(&shortcut.id()).cloned())
            .flatten()
    });
    if let Some(action) = action {
        fire(app, action);
    }
}

fn target_name(app: &AppHandle, t: Target) -> String {
    let state = app.state::<Engine>().state();
    let i = t.index as usize;
    match t.kind {
        TargetKind::Strip => state
            .strips
            .get(i)
            .map(|s| s.label.trim().to_string())
            .filter(|l| !l.is_empty())
            .unwrap_or_else(|| {
                layout::STRIP_DEFAULT_NAMES
                    .get(i)
                    .copied()
                    .unwrap_or("Strip")
                    .into()
            }),
        TargetKind::Bus => {
            let bus = layout::BUS_NAMES.get(i).copied().unwrap_or("Bus");
            match state
                .buses
                .get(i)
                .map(|b| b.label.trim())
                .filter(|l| !l.is_empty())
            {
                Some(l) => format!("{bus} ({l})"),
                None => bus.into(),
            }
        }
    }
}

/// Current value of a core param: our own recent write, else the engine snapshot.
fn current(app: &AppHandle, t: Target, gain: bool) -> Option<f32> {
    let name = if gain { t.gain() } else { t.mute() };
    if let Ok(inner) = app.state::<HotkeysState>().0.lock()
        && let Some((v, at)) = inner.pending.get(&name)
        && at.elapsed() < PENDING
    {
        return Some(*v);
    }
    let s = app.state::<Engine>().state();
    if !s.connection.is_connected() || s.rev == 0 {
        return None;
    }
    let i = t.index as usize;
    match (t.kind, gain) {
        (TargetKind::Strip, true) => s.strips.get(i).map(|x| x.gain),
        (TargetKind::Strip, false) => s.strips.get(i).map(|x| f32::from(u8::from(x.mute))),
        (TargetKind::Bus, true) => s.buses.get(i).map(|x| x.gain),
        (TargetKind::Bus, false) => s.buses.get(i).map(|x| f32::from(u8::from(x.mute))),
    }
}

fn remember(app: &AppHandle, name: &str, v: f32) {
    if let Ok(mut inner) = app.state::<HotkeysState>().0.lock() {
        inner.pending.retain(|_, (_, at)| at.elapsed() < PENDING);
        inner.pending.insert(name.to_string(), (v, Instant::now()));
    }
}

fn not_connected(app: &AppHandle) {
    notify::toast(
        app,
        Notice::new(NoticeKind::Error, "Hotkey ignored")
            .description("Voicemeeter isn't connected."),
    );
}

fn write(app: &AppHandle, name: String, value: f32, ok: Notice) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let engine = app.state::<Engine>();
        let r = engine
            .request(|reply| Command::SetParam {
                name: name.clone(),
                value: ParamValue::Num(value),
                reply,
            })
            .await;
        match r {
            Ok(()) => notify::toast(&app, ok),
            Err(e) => {
                if let Ok(mut inner) = app.state::<HotkeysState>().0.lock() {
                    inner.pending.remove(&name);
                }
                notify::toast(
                    &app,
                    Notice::new(NoticeKind::Error, "Hotkey failed")
                        .description(e)
                        .key("hotkey"),
                );
            }
        }
    });
}

fn fire(app: &AppHandle, action: HotkeyAction) {
    match action {
        HotkeyAction::ToggleWindow => window::toggle_main(app),
        HotkeyAction::ToggleMute { target } => {
            let Some(cur) = current(app, target, false) else {
                return not_connected(app);
            };
            let next = if cur >= 0.5 { 0.0 } else { 1.0 };
            let name = target.mute();
            remember(app, &name, next);
            let verb = if next >= 0.5 { "muted" } else { "unmuted" };
            let ok = Notice::new(
                NoticeKind::Info,
                format!("{} {verb}", target_name(app, target)),
            )
            .key(format!("hotkey:{name}"));
            write(app, name, next, ok);
        }
        HotkeyAction::Gain { target, delta } => {
            let Some(cur) = current(app, target, true) else {
                return not_connected(app);
            };
            let next = ((cur + delta) * 10.0).round() / 10.0;
            let next = next.clamp(GAIN_MIN, GAIN_MAX);
            let name = target.gain();
            remember(app, &name, next);
            let ok = Notice::new(
                NoticeKind::Info,
                format!("{} {:+.1} dB", target_name(app, target), next),
            )
            .key(format!("hotkey:{name}"));
            write(app, name, next, ok);
        }
        HotkeyAction::LoadPreset { id } => presets::load_in_background(app, id),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_requires_a_modifier() {
        assert!(parse("Control+Shift+KeyM").is_ok());
        assert!(parse("Alt+F5").is_ok());
        assert!(parse("F9").is_ok());
        assert!(parse("KeyM").is_err());
        assert!(parse("Control+Nope").is_err());
        assert_eq!(
            parse("Control+Shift+KeyM").unwrap().id(),
            parse("shift+ctrl+m").unwrap().id()
        );
    }

    #[test]
    fn action_wire_format() {
        let a = HotkeyAction::Gain {
            target: Target {
                kind: TargetKind::Bus,
                index: 0,
            },
            delta: -2.0,
        };
        let v = serde_json::to_value(&a).unwrap();
        assert_eq!(
            v,
            serde_json::json!({"kind":"gain","target":{"kind":"bus","index":0},"delta":-2.0})
        );
        let t: HotkeyAction = serde_json::from_str(r#"{"kind":"toggleWindow"}"#).unwrap();
        assert_eq!(t, HotkeyAction::ToggleWindow);
    }

    #[test]
    fn actions_are_validated() {
        let strip = |index| Target {
            kind: TargetKind::Strip,
            index,
        };
        assert!(
            HotkeyAction::ToggleMute { target: strip(7) }
                .validate()
                .is_ok()
        );
        assert!(
            HotkeyAction::ToggleMute { target: strip(8) }
                .validate()
                .is_err()
        );
        assert!(
            HotkeyAction::Gain {
                target: strip(0),
                delta: 0.0
            }
            .validate()
            .is_err()
        );
        assert!(
            HotkeyAction::Gain {
                target: strip(0),
                delta: 13.0
            }
            .validate()
            .is_err()
        );
        assert!(
            HotkeyAction::LoadPreset { id: " ".into() }
                .validate()
                .is_err()
        );
    }
}
