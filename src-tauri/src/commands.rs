//! Tauri commands exposed to the frontend. Errors are user-readable strings.

use tauri::{AppHandle, Manager, State};

use crate::settings::{self, Settings, SettingsError, SettingsPatch, SettingsState};
use crate::window;

/// The frontend calls this after its first paint; the window is shown then (no white flash),
/// unless "start minimized" is on.
#[tauri::command]
pub fn app_ready(app: AppHandle) {
    window::reveal_once(&app);
}

#[tauri::command]
pub fn get_settings(state: State<'_, SettingsState>) -> Result<Settings, String> {
    state.get().map_err(|e| e.to_string())
}

/// Applies a partial update, persists it, and returns the full new settings.
#[tauri::command]
pub fn set_settings(
    app: AppHandle,
    state: State<'_, SettingsState>,
    patch: SettingsPatch,
) -> Result<Settings, String> {
    apply(&app, &state, patch).map_err(|e| {
        log::warn!("set_settings failed: {e}");
        e.to_string()
    })
}

fn apply(
    app: &AppHandle,
    state: &SettingsState,
    patch: SettingsPatch,
) -> Result<Settings, SettingsError> {
    let current = state.get()?;
    let next = current.patched(patch)?;
    if next.launch_at_login != current.launch_at_login {
        set_autostart(app, next.launch_at_login)?;
    }
    settings::save(app, &next)?;
    state.replace(next.clone())?;
    if next.hotkeys != current.hotkeys {
        crate::hotkeys::apply(app, &next.hotkeys);
    }
    if next.apps != current.apps {
        crate::sessions::apply_settings(app, &next.apps);
    }
    Ok(next)
}

fn set_autostart(app: &AppHandle, enabled: bool) -> Result<(), SettingsError> {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    let result = if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    };
    result.map_err(|e| SettingsError::Autostart(e.to_string()))
}

// ---- Engine ----

use tauri::ipc::Channel;

use crate::engine::state::{EngineInfo, FakeEvent, Levels, MixerState, ParamValue};
use crate::engine::{Command, Engine};

/// Writes one parameter (`value`: number, bools as 0/1, or string).
#[tauri::command]
pub async fn set_param(
    engine: State<'_, Engine>,
    name: String,
    value: ParamValue,
) -> Result<(), String> {
    engine
        .request(|reply| Command::SetParam { name, value, reply })
        .await
}

/// Applies a `SetParameters` script atomically (≤ 48 kB; split with `params::script::Builder`).
#[tauri::command]
pub async fn set_script(engine: State<'_, Engine>, script: String) -> Result<(), String> {
    engine
        .request(|reply| Command::SetScript { script, reply })
        .await
}

#[tauri::command]
pub fn get_state(engine: State<'_, Engine>) -> MixerState {
    engine.state()
}

/// Starts reading a detail group (`"strip_fx:2"`, …); data arrives on `mixer://group`.
#[tauri::command]
pub async fn subscribe_group(engine: State<'_, Engine>, id: String) -> Result<(), String> {
    engine
        .request(|reply| Command::Subscribe { id, reply })
        .await
}

/// Re-reads a subscribed group now (the device list on picker open / Refresh).
#[tauri::command]
pub async fn refresh_group(engine: State<'_, Engine>, id: String) -> Result<(), String> {
    engine
        .request(|reply| Command::RefreshGroup { id, reply })
        .await
}

#[tauri::command]
pub fn unsubscribe_group(engine: State<'_, Engine>, id: String) -> Result<(), String> {
    engine.send(Command::Unsubscribe { id })
}

/// Streams `Levels` (~60/s) to `channel`. A new call replaces the previous channel.
#[tauri::command]
pub fn start_levels(engine: State<'_, Engine>, channel: Channel<Levels>) -> Result<(), String> {
    engine.send(Command::StartLevels(Box::new(move |l: &Levels| {
        channel.send(l.clone()).is_ok()
    })))
}

#[tauri::command]
pub async fn launch_voicemeeter(engine: State<'_, Engine>) -> Result<(), String> {
    engine.request(|reply| Command::Launch { reply }).await
}

#[tauri::command]
pub async fn restart_audio_engine(engine: State<'_, Engine>) -> Result<(), String> {
    engine
        .request(|reply| Command::RestartAudio { reply })
        .await
}

/// Look for Voicemeeter (and the DLL, if it wasn't found) right now.
#[tauri::command]
pub fn retry_connection(engine: State<'_, Engine>) -> Result<(), String> {
    engine.send(Command::Retry)
}

#[tauri::command]
pub fn get_engine_info(engine: State<'_, Engine>) -> EngineInfo {
    engine.info()
}

/// Switches between the real backend and the simulated one (demo mode). Not persisted.
#[tauri::command]
pub async fn set_demo_mode(engine: State<'_, Engine>, enabled: bool) -> Result<EngineInfo, String> {
    engine
        .request(|reply| Command::SetDemo { enabled, reply })
        .await
}

/// Demo mode only: simulate something happening in Voicemeeter.
#[tauri::command]
pub async fn simulate(engine: State<'_, Engine>, event: FakeEvent) -> Result<(), String> {
    engine
        .request(|reply| Command::Simulate { event, reply })
        .await
}

// ---- Presets ----

use crate::presets::{self, LoadReport, PresetSummary};

#[tauri::command]
pub fn list_presets(app: AppHandle) -> Result<Vec<PresetSummary>, String> {
    presets::list(&app).map_err(|e| e.to_string())
}

/// Snapshots `groups` (`"core"`, `"strip_fx:{i}"`, `"bus_eq:{j}"`) as preset `name`. With
/// `overwrite`, a preset of the same name is replaced (keeping its id); otherwise it's an error.
#[tauri::command]
pub async fn save_preset(
    app: AppHandle,
    name: String,
    groups: Vec<String>,
    overwrite: Option<bool>,
) -> Result<PresetSummary, String> {
    presets::save(&app, &name, &groups, overwrite.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_preset(app: AppHandle, id: String) -> Result<LoadReport, String> {
    presets::load(&app, &id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_preset(app: AppHandle, id: String, name: String) -> Result<PresetSummary, String> {
    presets::rename(&app, &id, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_preset(app: AppHandle, id: String) -> Result<(), String> {
    presets::delete(&app, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_presets_folder(app: AppHandle) -> Result<(), String> {
    presets::open_folder(&app).map_err(|e| e.to_string())
}

/// Asks Voicemeeter to save its full configuration (its own XML) to `path`.
#[tauri::command]
pub async fn export_vm_xml(app: AppHandle, path: String) -> Result<String, String> {
    presets::export_xml(&app, &path)
        .await
        .map_err(|e| e.to_string())
}

/// Asks Voicemeeter to load a configuration XML.
#[tauri::command]
pub async fn import_vm_xml(app: AppHandle, path: String) -> Result<(), String> {
    presets::import_xml(&app, &path)
        .await
        .map_err(|e| e.to_string())
}

// ---- Hotkeys ----

use crate::hotkeys::{self, HotkeyStatus};

/// Registration status of `Settings.hotkeys`, same order.
#[tauri::command]
pub fn get_hotkey_status(app: AppHandle) -> Vec<HotkeyStatus> {
    hotkeys::status(&app)
}

/// Turns hotkeys off while the recorder listens (true), then back on (false).
#[tauri::command]
pub fn set_hotkeys_paused(app: AppHandle, paused: bool) -> Vec<HotkeyStatus> {
    hotkeys::set_paused(&app, paused)
}

/// Checks an accelerator parses and Windows would accept it; returns its canonical form.
#[tauri::command]
pub fn check_hotkey(app: AppHandle, accelerator: String) -> Result<String, String> {
    hotkeys::check(&app, &accelerator)
}

// ---- About ----

use crate::about::{self, AboutInfo};

#[tauri::command]
pub fn get_about_info(app: AppHandle) -> AboutInfo {
    about::info(&app)
}

#[tauri::command]
pub fn open_log_folder(app: AppHandle) -> Result<(), String> {
    about::open_log_folder(&app)
}

// ---- App sessions ----

use crate::sessions::{
    self, AppLevels, Sessions, SessionsFakeEvent, SessionsState, SoundSettingsPage,
};

const SESSIONS_MISSING: &str = "App sessions didn't start. See the log.";

/// Latest apps per virtual strip / B bus (no round trip). Changes arrive on `sessions://state`.
#[tauri::command]
pub fn get_sessions(app: AppHandle) -> SessionsState {
    app.try_state::<Sessions>()
        .map(|s| s.state())
        .unwrap_or_else(|| SessionsState {
            status: sessions::SessionsStatus::Unavailable,
            error: Some(SESSIONS_MISSING.into()),
            ..Default::default()
        })
}

/// Windows session volume (0..1) of one app, as in the Windows volume mixer.
#[tauri::command]
pub async fn set_app_volume(app: AppHandle, key: String, volume: f32) -> Result<(), String> {
    let s = app.try_state::<Sessions>().ok_or(SESSIONS_MISSING)?;
    s.request(|reply| sessions::Command::SetVolume { key, volume, reply })
        .await
}

#[tauri::command]
pub async fn set_app_mute(app: AppHandle, key: String, muted: bool) -> Result<(), String> {
    let s = app.try_state::<Sessions>().ok_or(SESSIONS_MISSING)?;
    s.request(|reply| sessions::Command::SetMute { key, muted, reply })
        .await
}

/// Streams per-app peaks (~15/s, foreground only) to `channel`. A new call replaces the old one.
#[tauri::command]
pub fn start_app_levels(app: AppHandle, channel: Channel<AppLevels>) -> Result<(), String> {
    let s = app.try_state::<Sessions>().ok_or(SESSIONS_MISSING)?;
    s.send(sessions::Command::StartLevels(Box::new(
        move |l: &AppLevels| channel.send(l.clone()).is_ok(),
    )))
}

/// Scans now (and retries Windows audio if it had failed). Resolves after the scan.
#[tauri::command]
pub async fn rescan_sessions(app: AppHandle) -> Result<(), String> {
    let s = app.try_state::<Sessions>().ok_or(SESSIONS_MISSING)?;
    s.request(sessions::Command::Rescan).await
}

/// Opens Windows Settings › Volume mixer or › Sound.
#[tauri::command]
pub fn open_sound_settings(app: AppHandle, page: SoundSettingsPage) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(page.uri(), None::<&str>)
        .map_err(|e| format!("Couldn't open Windows Settings: {e}"))
}

/// Simulated sessions only (`MIXDECK_FAKE`): add or remove a demo app.
#[tauri::command]
pub async fn simulate_sessions(app: AppHandle, event: SessionsFakeEvent) -> Result<(), String> {
    let s = app.try_state::<Sessions>().ok_or(SESSIONS_MISSING)?;
    s.request(|reply| sessions::Command::Simulate { event, reply })
        .await
}
