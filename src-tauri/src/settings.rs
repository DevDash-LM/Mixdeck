//! App settings: the `Settings` struct, its patch type, and persistence through
//! `tauri-plugin-store` (`settings.json` in the app-data folder, key `settings`).

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;
use ts_rs::TS;

use crate::hotkeys::{HotkeyAction, MAX_HOTKEYS};
use crate::sessions::AppsSettings;
use crate::vmr::layout::STRIPS;

pub const STORE_FILE: &str = "settings.json";
const STORE_KEY: &str = "settings";

#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("Couldn't open the settings file: {0}")]
    Store(#[from] tauri_plugin_store::Error),
    #[error("Couldn't encode settings: {0}")]
    Encode(#[from] serde_json::Error),
    #[error("Meter mode must be 0, 1 or 2 (got {0}).")]
    InvalidMeterMode(u8),
    #[error("Couldn't change launch at login: {0}")]
    Autostart(String),
    #[error("Hotkey {index}: {message}")]
    InvalidHotkey { index: usize, message: String },
    #[error("You can set up to {0} hotkeys.")]
    TooManyHotkeys(usize),
    #[error("Apps: {0}")]
    InvalidApps(String),
    #[error("There's no input strip {0} to collapse.")]
    InvalidCollapsedStrip(u8),
    #[error("Settings are temporarily unavailable. Try again.")]
    Poisoned,
}

/// A global hotkey binding. `accelerator` is a `global-hotkey` string such as
/// `"Control+Shift+KeyM"`; empty means "not recorded yet" (kept, but not registered).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct Hotkey {
    pub accelerator: String,
    pub action: HotkeyAction,
}

/// Reads the hotkey list one entry at a time, dropping entries that don't parse (e.g. the
/// old placeholder string actions), so one bad entry never resets all settings.
fn lenient_hotkeys<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<Hotkey>, D::Error> {
    let raw = match serde_json::Value::deserialize(d)? {
        serde_json::Value::Array(items) => items,
        _ => Vec::new(),
    };
    Ok(raw
        .into_iter()
        .filter_map(|v| match serde_json::from_value::<Hotkey>(v) {
            Ok(h) => Some(h),
            Err(e) => {
                log::warn!("settings: dropping an unreadable hotkey: {e}");
                None
            }
        })
        .collect())
}

/// Persisted user settings. Unknown/missing fields fall back to defaults, so
/// adding a field later never breaks an existing settings file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct Settings {
    /// Boot straight to the tray without showing the window.
    pub start_minimized: bool,
    /// The window's close button hides to the tray instead of quitting.
    pub close_to_tray: bool,
    /// Register with Windows to start at login (tauri-plugin-autostart).
    pub launch_at_login: bool,
    /// Meter tap: 0 = pre-fader, 1 = post-fader, 2 = post-mute (GetLevel type). See D2.
    pub meter_mode: u8,
    #[serde(deserialize_with = "lenient_hotkeys")]
    pub hotkeys: Vec<Hotkey>,
    /// Settings › Apps: app sessions on/off, system sounds, icon look,
    /// endpoint overrides.
    pub apps: AppsSettings,
    /// Input strips shown as a 36px rail on the Mixer.
    /// Strip indices 0–7, sorted, no duplicates.
    pub collapsed_strips: Vec<u8>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            start_minimized: false,
            close_to_tray: true,
            launch_at_login: false,
            meter_mode: 1,
            hotkeys: Vec::new(),
            apps: AppsSettings::default(),
            collapsed_strips: Vec::new(),
        }
    }
}

/// Partial update for `set_settings`. Absent fields are left unchanged.
#[derive(Debug, Clone, Default, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct SettingsPatch {
    #[ts(optional)]
    pub start_minimized: Option<bool>,
    #[ts(optional)]
    pub close_to_tray: Option<bool>,
    #[ts(optional)]
    pub launch_at_login: Option<bool>,
    #[ts(optional)]
    pub meter_mode: Option<u8>,
    #[ts(optional)]
    pub hotkeys: Option<Vec<Hotkey>>,
    /// Replaces the whole Apps block.
    #[ts(optional)]
    pub apps: Option<AppsSettings>,
    /// Replaces the whole list (sorted and de-duplicated on save).
    #[ts(optional)]
    pub collapsed_strips: Option<Vec<u8>>,
}

impl Settings {
    /// Returns a copy with `patch` applied, or an error if the result is invalid.
    pub fn patched(&self, patch: SettingsPatch) -> Result<Settings, SettingsError> {
        let mut next = self.clone();
        if let Some(v) = patch.start_minimized {
            next.start_minimized = v;
        }
        if let Some(v) = patch.close_to_tray {
            next.close_to_tray = v;
        }
        if let Some(v) = patch.launch_at_login {
            next.launch_at_login = v;
        }
        if let Some(v) = patch.meter_mode {
            next.meter_mode = v;
        }
        if let Some(v) = patch.hotkeys {
            next.hotkeys = v;
        }
        if let Some(v) = patch.apps {
            next.apps = v;
        }
        if let Some(v) = patch.collapsed_strips {
            next.collapsed_strips = normalize_collapsed(v);
        }
        next.validate()?;
        Ok(next)
    }

    fn validate(&self) -> Result<(), SettingsError> {
        if self.meter_mode > 2 {
            return Err(SettingsError::InvalidMeterMode(self.meter_mode));
        }
        if self.hotkeys.len() > MAX_HOTKEYS {
            return Err(SettingsError::TooManyHotkeys(MAX_HOTKEYS));
        }
        crate::sessions::mapping::validate_rules(&self.apps.endpoint_rules)
            .map_err(SettingsError::InvalidApps)?;
        if let Some(&bad) = self
            .collapsed_strips
            .iter()
            .find(|&&i| usize::from(i) >= STRIPS)
        {
            return Err(SettingsError::InvalidCollapsedStrip(bad));
        }
        for (i, h) in self.hotkeys.iter().enumerate() {
            h.action
                .validate()
                .map_err(|message| SettingsError::InvalidHotkey {
                    index: i + 1,
                    message,
                })?;
        }
        Ok(())
    }
}

/// Sorted, de-duplicated collapsed-strip list.
fn normalize_collapsed(mut v: Vec<u8>) -> Vec<u8> {
    v.sort_unstable();
    v.dedup();
    v
}

/// Managed state holding the live settings.
#[derive(Default)]
pub struct SettingsState(pub Mutex<Settings>);

impl SettingsState {
    pub fn get(&self) -> Result<Settings, SettingsError> {
        self.0
            .lock()
            .map(|s| s.clone())
            .map_err(|_| SettingsError::Poisoned)
    }

    pub fn replace(&self, next: Settings) -> Result<(), SettingsError> {
        let mut guard = self.0.lock().map_err(|_| SettingsError::Poisoned)?;
        *guard = next;
        Ok(())
    }
}

/// Loads settings from disk. A missing or unreadable entry yields defaults (and a log line).
pub fn load<R: Runtime>(app: &AppHandle<R>) -> Settings {
    let store = match app.store(STORE_FILE) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("settings store unavailable, using defaults: {e}");
            return Settings::default();
        }
    };
    match store.get(STORE_KEY) {
        None => Settings::default(),
        Some(value) => match serde_json::from_value::<Settings>(value) {
            Ok(mut s) => {
                if s.meter_mode > 2 {
                    log::warn!("invalid meter_mode {} in settings; resetting", s.meter_mode);
                    s.meter_mode = Settings::default().meter_mode;
                }
                s.hotkeys.truncate(MAX_HOTKEYS);
                s.hotkeys.retain(|h| h.action.validate().is_ok());
                if let Err(e) = crate::sessions::mapping::validate_rules(&s.apps.endpoint_rules) {
                    log::warn!("settings: dropping invalid app endpoint rules: {e}");
                    s.apps.endpoint_rules.clear();
                }
                s.collapsed_strips.retain(|&i| usize::from(i) < STRIPS);
                s.collapsed_strips = normalize_collapsed(std::mem::take(&mut s.collapsed_strips));
                s
            }
            Err(e) => {
                log::warn!("settings file unreadable, using defaults: {e}");
                Settings::default()
            }
        },
    }
}

/// Writes settings to disk immediately.
pub fn save<R: Runtime>(app: &AppHandle<R>, settings: &Settings) -> Result<(), SettingsError> {
    let store = app.store(STORE_FILE)?;
    store.set(STORE_KEY, serde_json::to_value(settings)?);
    store.save()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patch_changes_only_given_fields() {
        let base = Settings::default();
        let next = base
            .patched(SettingsPatch {
                start_minimized: Some(true),
                ..Default::default()
            })
            .unwrap();
        assert!(next.start_minimized);
        assert_eq!(next.close_to_tray, base.close_to_tray);
        assert_eq!(next.meter_mode, base.meter_mode);
    }

    #[test]
    fn patch_rejects_bad_meter_mode() {
        let err = Settings::default()
            .patched(SettingsPatch {
                meter_mode: Some(3),
                ..Default::default()
            })
            .unwrap_err();
        assert!(matches!(err, SettingsError::InvalidMeterMode(3)));
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let s: Settings = serde_json::from_str(r#"{"startMinimized":true}"#).unwrap();
        assert!(s.start_minimized);
        assert_eq!(s.meter_mode, 1);
        assert!(s.close_to_tray);
    }

    #[test]
    fn bad_hotkeys_are_dropped_not_fatal() {
        let s: Settings = serde_json::from_str(
            r#"{"startMinimized":true,"hotkeys":[
                {"accelerator":"Control+KeyM","action":"old-string"},
                {"accelerator":"Control+KeyN","action":{"kind":"toggleWindow"}}
            ]}"#,
        )
        .unwrap();
        assert!(s.start_minimized);
        assert_eq!(s.hotkeys.len(), 1);
        assert_eq!(s.hotkeys[0].action, HotkeyAction::ToggleWindow);
        let s: Settings = serde_json::from_str(r#"{"hotkeys":"nope"}"#).unwrap();
        assert!(s.hotkeys.is_empty());
    }

    #[test]
    fn invalid_hotkey_action_is_rejected() {
        let err = Settings::default()
            .patched(SettingsPatch {
                hotkeys: Some(vec![Hotkey {
                    accelerator: "Control+KeyM".into(),
                    action: HotkeyAction::LoadPreset { id: "".into() },
                }]),
                ..Default::default()
            })
            .unwrap_err();
        assert!(matches!(err, SettingsError::InvalidHotkey { index: 1, .. }));
    }

    #[test]
    fn apps_default_on_and_validate() {
        let s: Settings = serde_json::from_str(r#"{"startMinimized":true}"#).unwrap();
        assert!(s.apps.enabled);
        assert!(!s.apps.show_system_sounds);
        let err = Settings::default()
            .patched(SettingsPatch {
                apps: Some(AppsSettings {
                    endpoint_rules: vec![crate::sessions::EndpointRule {
                        target: crate::sessions::SessionTarget::strip(1),
                        endpoint: "x".into(),
                    }],
                    ..Default::default()
                }),
                ..Default::default()
            })
            .unwrap_err();
        assert!(matches!(err, SettingsError::InvalidApps(_)));
    }

    #[test]
    fn collapsed_strips_are_normalized_and_validated() {
        let next = Settings::default()
            .patched(SettingsPatch {
                collapsed_strips: Some(vec![6, 3, 6, 0]),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(next.collapsed_strips, vec![0, 3, 6]);
        let err = Settings::default()
            .patched(SettingsPatch {
                collapsed_strips: Some(vec![8]),
                ..Default::default()
            })
            .unwrap_err();
        assert!(matches!(err, SettingsError::InvalidCollapsedStrip(8)));
        let old: Settings = serde_json::from_str(r#"{"startMinimized":true}"#).unwrap();
        assert!(old.collapsed_strips.is_empty());
    }

    #[test]
    fn wire_format_is_camel_case() {
        let v = serde_json::to_value(Settings::default()).unwrap();
        assert!(v.get("closeToTray").is_some());
        assert!(v.get("close_to_tray").is_none());
    }
}
