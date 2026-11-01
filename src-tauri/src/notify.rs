//! Toasts raised from Rust (hotkeys and tray preset loads act in Rust, so they work
//! while the window is hidden). Emitted as `notify://toast` only while the main window is
//! visible; when it's hidden there's nobody to show them to, so they're just logged.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use ts_rs::TS;

pub const EVENT_TOAST: &str = "notify://toast";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub enum NoticeKind {
    Success,
    Info,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct Notice {
    pub kind: NoticeKind,
    pub title: String,
    pub description: Option<String>,
    /// Toasts with the same key replace each other (e.g. repeated gain hotkey presses).
    pub key: Option<String>,
}

impl Notice {
    pub fn new(kind: NoticeKind, title: impl Into<String>) -> Self {
        Self {
            kind,
            title: title.into(),
            description: None,
            key: None,
        }
    }
    pub fn description(mut self, d: impl Into<String>) -> Self {
        self.description = Some(d.into());
        self
    }
    pub fn key(mut self, k: impl Into<String>) -> Self {
        self.key = Some(k.into());
        self
    }
}

/// True when the main window is shown and not minimized.
pub fn window_visible<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.get_webview_window("main")
        .is_some_and(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
}

/// Shows `notice` as a toast if the window is visible.
pub fn toast<R: Runtime>(app: &AppHandle<R>, notice: Notice) {
    if notice.kind == NoticeKind::Error {
        log::warn!(
            "{}: {}",
            notice.title,
            notice.description.as_deref().unwrap_or("")
        );
    }
    if !window_visible(app) {
        return;
    }
    if let Err(e) = app.emit(EVENT_TOAST, &notice) {
        log::warn!("notify: couldn't emit a toast: {e}");
    }
}
