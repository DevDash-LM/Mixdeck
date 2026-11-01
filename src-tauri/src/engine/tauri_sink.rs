//! Tauri glue: events out, settings in, tray restart action, startup and shutdown.

use tauri::{AppHandle, Emitter, Listener, Manager};

use super::state::{ConnectionState, GroupEvent, MixerState};
use super::{Command, Engine, Options, Sink};
use crate::settings::SettingsState;
use crate::tray;

pub const EVENT_STATE: &str = "mixer://state";
pub const EVENT_GROUP: &str = "mixer://group";
pub const EVENT_CONNECTION: &str = "mixer://connection";
/// Tray "Restart audio engine" payload (see tray.rs).
const TRAY_RESTART: &str = "restart-engine";

struct TauriSink {
    app: AppHandle,
}

impl TauriSink {
    fn emit<T: serde::Serialize + Clone>(&self, event: &str, payload: &T) {
        if let Err(e) = self.app.emit(event, payload) {
            log::warn!("engine: couldn't emit {event}: {e}");
        }
    }
}

impl Sink for TauriSink {
    fn state(&self, s: &MixerState) {
        self.emit(EVENT_STATE, s);
    }
    fn group(&self, ev: &GroupEvent) {
        self.emit(EVENT_GROUP, ev);
    }
    fn connection(&self, c: &ConnectionState) {
        self.emit(EVENT_CONNECTION, c);
        if let Err(e) = tray::set_restart_enabled(&self.app, c.is_connected()) {
            log::warn!("engine: couldn't update the tray: {e}");
        }
    }
    fn meter_mode(&self) -> u8 {
        self.app
            .state::<SettingsState>()
            .get()
            .map(|s| s.meter_mode)
            .unwrap_or(1)
    }
}

/// Starts the engine and registers it as managed state. Call from `setup`, after settings load.
pub fn init(app: &AppHandle) -> std::io::Result<()> {
    let opts = Options::from_env();
    if let Some(start) = opts.fake {
        log::info!(
            "engine: {} set, using the fake backend ({start:?})",
            super::FAKE_ENV
        );
    }
    let engine = Engine::spawn(TauriSink { app: app.clone() }, opts)?;
    // The window starts hidden; `window::show_main` brings the engine to the foreground when
    // it's revealed (never, when starting minimized).
    engine.set_background(true);
    app.manage(engine);

    let handle = app.clone();
    app.listen_any(tray::EVENT_ACTION, move |event| {
        let action: String = serde_json::from_str(event.payload()).unwrap_or_default();
        if action == TRAY_RESTART {
            let engine = handle.state::<Engine>();
            if let Err(e) = engine.send(Command::RestartAudio { reply: None }) {
                log::warn!("engine: tray restart failed: {e}");
            }
        }
    });
    Ok(())
}

/// Stops the worker (logs out of the DLL). Call on `RunEvent::Exit`.
pub fn shutdown(app: &AppHandle) {
    if let Some(engine) = app.try_state::<Engine>() {
        engine.shutdown();
    }
}
