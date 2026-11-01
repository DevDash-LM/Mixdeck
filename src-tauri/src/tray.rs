//! System tray icon and menu.
//!
//! Menu: Show / Hide · Restart audio engine · Presets ▸ · Settings · Quit.
//! Left-click toggles the main window. Items this module doesn't own are forwarded as events:
//! - `tray://action`   payload: item id (`"restart-engine"`), for the engine
//! - `tray://preset`   payload: preset id, for presets
//! - `tray://navigate` payload: view id (`"settings"`), for the frontend

use std::sync::Mutex;

use serde::Serialize;
use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::window;

pub const EVENT_ACTION: &str = "tray://action";
pub const EVENT_PRESET: &str = "tray://preset";
pub const EVENT_NAVIGATE: &str = "tray://navigate";

const ID_TOGGLE: &str = "toggle";
const ID_RESTART: &str = "restart-engine";
const ID_SETTINGS: &str = "settings";
const ID_QUIT: &str = "quit";
const ID_PRESETS_EMPTY: &str = "presets-empty";
const PRESET_PREFIX: &str = "preset:";

/// One entry in the tray's Presets submenu.
#[derive(Debug, Clone, Serialize)]
pub struct PresetMenuItem {
    pub id: String,
    pub label: String,
}

struct Handles {
    presets: Submenu<Wry>,
    restart: MenuItem<Wry>,
}

#[derive(Default)]
pub struct TrayState(Mutex<Option<Handles>>);

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, ID_TOGGLE, "Show / Hide", true, None::<&str>)?;
    // Disabled until the engine exists.
    let restart = MenuItem::with_id(app, ID_RESTART, "Restart audio engine", false, None::<&str>)?;
    let empty = MenuItem::with_id(app, ID_PRESETS_EMPTY, "No presets yet", false, None::<&str>)?;
    let presets = Submenu::with_items(app, "Presets", true, &[&empty])?;
    let settings = MenuItem::with_id(app, ID_SETTINGS, "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, ID_QUIT, "Quit Mixdeck", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[&toggle, &sep1, &restart, &presets, &settings, &sep2, &quit],
    )?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Mixdeck")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                window::toggle_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;

    if let Ok(mut guard) = app.state::<TrayState>().0.lock() {
        *guard = Some(Handles { presets, restart });
    }
    Ok(())
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        ID_TOGGLE => window::toggle_main(app),
        ID_QUIT => app.exit(0),
        ID_SETTINGS => {
            window::show_main(app);
            emit(app, EVENT_NAVIGATE, ID_SETTINGS);
        }
        ID_RESTART => emit(app, EVENT_ACTION, ID_RESTART),
        other => {
            if let Some(preset) = other.strip_prefix(PRESET_PREFIX) {
                emit(app, EVENT_PRESET, preset);
            }
        }
    }
}

fn emit(app: &AppHandle, event: &str, payload: &str) {
    if let Err(e) = app.emit(event, payload) {
        log::warn!("tray: couldn't emit {event}: {e}");
    }
}

/// Replaces the Presets submenu. An empty list shows a disabled "No presets yet" entry.
/// Clicking an item emits `tray://preset` with its `id`.
pub fn set_presets_menu(app: &AppHandle, items: &[PresetMenuItem]) -> tauri::Result<()> {
    let state = app.state::<TrayState>();
    let Ok(guard) = state.0.lock() else {
        log::warn!("tray: state lock poisoned; presets menu not updated");
        return Ok(());
    };
    let Some(handles) = guard.as_ref() else {
        return Ok(());
    };
    let submenu = &handles.presets;
    for old in submenu.items()? {
        submenu.remove(&old)?;
    }
    if items.is_empty() {
        let empty =
            MenuItem::with_id(app, ID_PRESETS_EMPTY, "No presets yet", false, None::<&str>)?;
        submenu.append(&empty)?;
    } else {
        let built: Vec<MenuItem<Wry>> = items
            .iter()
            .map(|p| {
                MenuItem::with_id(
                    app,
                    format!("{PRESET_PREFIX}{}", p.id),
                    &p.label,
                    true,
                    None::<&str>,
                )
            })
            .collect::<tauri::Result<_>>()?;
        let refs: Vec<&dyn IsMenuItem<Wry>> =
            built.iter().map(|m| m as &dyn IsMenuItem<Wry>).collect();
        submenu.append_items(&refs)?;
    }
    Ok(())
}

/// Enables/disables "Restart audio engine" (the engine turns it on once connected).
pub fn set_restart_enabled(app: &AppHandle, enabled: bool) -> tauri::Result<()> {
    let state = app.state::<TrayState>();
    if let Ok(guard) = state.0.lock() {
        if let Some(h) = guard.as_ref() {
            h.restart.set_enabled(enabled)?;
        }
    }
    Ok(())
}
