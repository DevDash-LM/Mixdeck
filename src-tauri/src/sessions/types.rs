//! Wire types for app sessions (ts-rs → `src/lib/generated/`), plus the persisted Apps settings.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Which side of the board an endpoint feeds: a virtual input strip (Windows playback endpoint)
/// or a virtual B bus (Windows recording endpoint).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub enum SessionTargetKind {
    Strip,
    Bus,
}

/// A strip (`index` 5..=7, the virtual inputs) or a bus (`index` 5..=7, B1..B3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct SessionTarget {
    pub kind: SessionTargetKind,
    pub index: u8,
}

impl SessionTarget {
    pub const fn strip(index: u8) -> Self {
        Self {
            kind: SessionTargetKind::Strip,
            index,
        }
    }
    pub const fn bus(index: u8) -> Self {
        Self {
            kind: SessionTargetKind::Bus,
            index,
        }
    }
}

/// One Windows audio session (an app playing into, or recording from, an endpoint).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct AppSession {
    /// Stable for the life of the session (hash of its instance id). Use it for volume/mute
    /// and to look up `appLevels`.
    pub key: String,
    pub pid: u32,
    /// What the Windows volume mixer would show: session display name, file description,
    /// exe stem, or "App (pid N)".
    pub name: String,
    /// Full image path, when the process could be opened.
    pub exe: Option<String>,
    /// `data:image/png;base64,…` (the system large icon, 32px at 100 %), when available.
    pub icon: Option<String>,
    /// The session's stream is running (playing/recording) right now.
    pub active: bool,
    /// Session volume, 0..1 (`ISimpleAudioVolume`, same as the Windows volume mixer).
    pub volume: f32,
    pub muted: bool,
    /// The Windows "System sounds" session.
    pub system: bool,
}

/// The apps on one mapped endpoint.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct EndpointApps {
    pub target: SessionTarget,
    /// Windows friendly name of the endpoint (e.g. "Voicemeeter Input"), when found.
    pub endpoint: Option<String>,
    /// An active endpoint matched this target.
    pub found: bool,
    pub apps: Vec<AppSession>,
}

/// Health of the sessions module.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub enum SessionsStatus {
    /// Nothing scanned yet.
    #[default]
    Starting,
    Ready,
    /// Windows audio couldn't be used (see `error`); the UI shows "apps unavailable".
    Unavailable,
    /// Turned off in Settings › Apps.
    Disabled,
}

/// Everything the UI needs. Emitted on `sessions://state` only when it changes.
#[derive(Debug, Clone, PartialEq, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct SessionsState {
    /// Always the six targets (strips 5–7, buses 5–7) in that order, once `status` is ready.
    pub endpoints: Vec<EndpointApps>,
    /// Increases on every change; 0 = nothing scanned yet.
    #[ts(type = "number")]
    pub rev: u64,
    pub status: SessionsStatus,
    /// Readable reason when `status` is unavailable.
    pub error: Option<String>,
    /// Simulated sessions (`MIXDECK_FAKE`).
    pub fake: bool,
}

impl SessionsState {
    pub fn find_app(&self, key: &str) -> Option<&AppSession> {
        self.endpoints
            .iter()
            .flat_map(|e| e.apps.iter())
            .find(|a| a.key == key)
    }

    pub fn find_app_mut(&mut self, key: &str) -> Option<&mut AppSession> {
        self.endpoints
            .iter_mut()
            .flat_map(|e| e.apps.iter_mut())
            .find(|a| a.key == key)
    }
}

/// Per-app peaks, linear 0..1, sent ~15×/s over an `ipc::Channel` while the window is in the
/// foreground. Only apps on mapped endpoints.
#[derive(Debug, Clone, PartialEq, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct AppLevels {
    pub peaks: Vec<(String, f32)>,
}

/// `open_sound_settings` target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub enum SoundSettingsPage {
    /// `ms-settings:apps-volume` (per-app volume and device).
    VolumeMixer,
    /// `ms-settings:sound`.
    Sound,
}

impl SoundSettingsPage {
    pub fn uri(self) -> &'static str {
        match self {
            Self::VolumeMixer => "ms-settings:apps-volume",
            Self::Sound => "ms-settings:sound",
        }
    }
}

/// Dev/demo only: things the simulated sessions can do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub enum SessionsFakeEvent {
    /// Start the next app from a small pool (VLC on V IN 3 first, so an empty strip fills).
    AddApp,
    /// Stop the most recently added app (or the last one listed).
    RemoveApp,
}

/// Overrides which Windows endpoint feeds a target, by its endpoint name
/// (e.g. "Voicemeeter AUX Input", as in Windows Sound settings). Compared case-insensitively,
/// trimmed. Unlike the defaults, an override may point at any device, not just Voicemeeter's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct EndpointRule {
    pub target: SessionTarget,
    pub endpoint: String,
}

/// Settings › Apps (persisted inside `Settings.apps`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct AppsSettings {
    /// Watch Windows audio sessions at all.
    pub enabled: bool,
    /// List the Windows "System sounds" session too.
    pub show_system_sounds: bool,
    /// Draw app icons in greyscale (UI only).
    pub monochrome_icons: bool,
    /// List sessions that aren't playing/recording right now, dimmed (UI only).
    pub show_inactive: bool,
    /// Replaces the default endpoint for a target (at most one rule per target).
    pub endpoint_rules: Vec<EndpointRule>,
}

impl Default for AppsSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            show_system_sounds: false,
            monochrome_icons: false,
            show_inactive: true,
            endpoint_rules: Vec::new(),
        }
    }
}

/// Stable session key: FNV-1a 64 of the session instance identifier, as 16 hex digits.
/// The instance id is unique per session and constant for its lifetime, so the key is too.
pub fn session_key(instance_id: &str) -> String {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;
    let mut h = OFFSET;
    for b in instance_id.as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(PRIME);
    }
    format!("{h:016x}")
}
