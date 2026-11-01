//! Settings → About: DLL path and file version, Voicemeeter version, folders.

use serde::Serialize;
use tauri::{AppHandle, Manager};
use ts_rs::TS;

use crate::engine::Engine;
use crate::engine::state::{BackendKind, ConnectionState};
use crate::{presets, vmr};

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct AboutInfo {
    pub app_version: String,
    pub backend: BackendKind,
    /// The loaded DLL, or where discovery would find it (registry first).
    pub dll_path: Option<String>,
    /// File version of that DLL (read from the file, not loaded).
    pub dll_version: Option<String>,
    /// Running Voicemeeter version, when connected.
    pub vm_version: Option<String>,
    pub log_dir: Option<String>,
    pub presets_dir: Option<String>,
}

pub fn info(app: &AppHandle) -> AboutInfo {
    let engine = app.state::<Engine>();
    let engine_info = engine.info();
    let dll_path = engine_info
        .dll_path
        .clone()
        .map(std::path::PathBuf::from)
        .or_else(|| vmr::locate_dll().ok());
    let dll_version = dll_path
        .as_deref()
        .and_then(|p| vmr::inspect_dll(p).ok())
        .and_then(|i| i.file_version)
        .map(|v| format!("{}.{}.{}.{}", v[0], v[1], v[2], v[3]));
    let vm_version = match engine.state().connection {
        ConnectionState::Connected { version, .. } => Some(version),
        _ => None,
    };
    AboutInfo {
        app_version: app.package_info().version.to_string(),
        backend: engine_info.backend,
        dll_path: dll_path.map(|p| p.to_string_lossy().into_owned()),
        dll_version,
        vm_version,
        log_dir: app
            .path()
            .app_log_dir()
            .ok()
            .map(|p| p.to_string_lossy().into_owned()),
        presets_dir: presets::presets_dir(app)
            .ok()
            .map(|p| p.to_string_lossy().into_owned()),
    }
}

pub fn open_log_folder(app: &AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Couldn't find the log folder: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create the log folder: {e}"))?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("Couldn't open the log folder: {e}"))
}
