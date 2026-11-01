//! Main-window behaviour: show/hide/toggle, first-paint reveal, close-to-tray.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime, WebviewWindow, Window, WindowEvent};

use crate::engine::Engine;
use crate::settings::SettingsState;

pub const MAIN: &str = "main";

/// If the frontend never reports its first paint (e.g. a JS crash), reveal the window anyway
/// after this long so the app is never stuck invisible.
const REVEAL_FALLBACK: Duration = Duration::from_secs(4);

/// Set once the first reveal decision has been made (by `app_ready` or the fallback).
#[derive(Default)]
pub struct RevealState(AtomicBool);

fn main_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(MAIN)
}

/// Hidden or minimized windows draw no meters, so the engine stops reading levels (perf: idle
/// in the tray should cost next to nothing). No-op before the engine is managed.
fn set_background<R: Runtime>(app: &AppHandle<R>, background: bool) {
    if let Some(engine) = app.try_state::<Engine>() {
        engine.set_background(background);
    }
    crate::sessions::set_background(app, background);
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    set_background(app, false);
    if let Some(w) = main_window(app) {
        if let Err(e) = w
            .unminimize()
            .and_then(|_| w.show())
            .and_then(|_| w.set_focus())
        {
            log::warn!("couldn't show main window: {e}");
        }
    }
}

pub fn hide_main<R: Runtime>(app: &AppHandle<R>) {
    set_background(app, true);
    if let Some(w) = main_window(app) {
        if let Err(e) = w.hide() {
            log::warn!("couldn't hide main window: {e}");
        }
    }
}

/// Tray left-click: hide if visible and not minimized, otherwise bring it up.
pub fn toggle_main<R: Runtime>(app: &AppHandle<R>) {
    let Some(w) = main_window(app) else { return };
    let visible = w.is_visible().unwrap_or(false);
    let minimized = w.is_minimized().unwrap_or(false);
    if visible && !minimized {
        hide_main(app);
    } else {
        show_main(app);
    }
}

fn start_minimized<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.state::<SettingsState>()
        .get()
        .map(|s| s.start_minimized)
        .unwrap_or(false)
}

/// Called once per launch, from `app_ready` (first paint) or the fallback timer.
/// Shows the window unless "start minimized" is on.
pub fn reveal_once<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<RevealState>();
    if state.0.swap(true, Ordering::SeqCst) {
        return;
    }
    if start_minimized(app) {
        log::info!("start minimized: staying in tray");
    } else {
        show_main(app);
    }
}

/// Called from setup. Keeps the window hidden when starting minimized (window-state never
/// restores visibility; see lib.rs) and arms the reveal fallback.
pub fn init<R: Runtime>(app: &AppHandle<R>) {
    if start_minimized(app) {
        hide_main(app);
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(REVEAL_FALLBACK);
        let h = handle.clone();
        if let Err(e) = handle.run_on_main_thread(move || reveal_once(&h)) {
            log::warn!("reveal fallback failed: {e}");
        }
    });
}

/// Window event hook: close-to-tray, and meters pause while minimized.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if window.label() != MAIN {
        return;
    }
    if let WindowEvent::Resized(_) = event {
        // Minimize and restore both arrive as a resize. Runs on the event-loop thread, so the
        // getters don't block.
        let minimized = window.is_minimized().unwrap_or(false);
        let visible = window.is_visible().unwrap_or(true);
        set_background(window.app_handle(), minimized || !visible);
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        let to_tray = window
            .app_handle()
            .state::<SettingsState>()
            .get()
            .map(|s| s.close_to_tray)
            .unwrap_or(true);
        if to_tray {
            api.prevent_close();
            set_background(window.app_handle(), true);
            if let Err(e) = window.hide() {
                log::warn!("couldn't hide on close: {e}");
            }
        } else {
            // Closing the only window quits the app (the tray icon alone doesn't keep it alive).
            window.app_handle().exit(0);
        }
    }
}
