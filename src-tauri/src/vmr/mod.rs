//! Remote API wrapper for `VoicemeeterRemote64.dll`.
//!
//! **No Tauri, no serde-to-UI, no UI logic** here. Only `engine/` uses this module, through
//! its `VmBackend` trait, and only from the engine's single worker thread.

pub mod client;
pub mod error;
pub mod ffi;
pub mod layout;
pub mod locate;
pub mod params;
pub mod pe;

pub use client::{
    DeviceDesc, DeviceKind, LevelKind, LoginStatus, RunKind, VmType, VmrClient, format_version,
};
pub use error::VmrError;
pub use locate::{LocateSource, Located, locate_dll, locate_dll_detailed};
pub use pe::{DllFileInfo, ExportReport, compare_exports, inspect_dll};

/// The Voicemeeter Potato build Mixdeck targets. Older builds only log a warning.
pub const TARGET_VM_VERSION: [u8; 4] = [3, 1, 3, 0];
