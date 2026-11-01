//! Mixdeck app builder: plugins, tray, window, state, commands.

mod about;
mod commands;
pub mod engine;
pub mod hotkeys;
pub mod notify;
pub mod presets;
pub mod sessions;
mod settings;
pub mod tray;
pub mod vmr;
mod window;

use tauri::{Manager, RunEvent};
use tauri_plugin_window_state::StateFlags;

pub use settings::{Hotkey, Settings, SettingsPatch};

/// Panics go to the log file as well as stderr (a release build has no console, so stderr alone
/// would lose them). Runs for panics the engine catches and restarts from, too.
fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let name = thread.name().unwrap_or("<unnamed>");
        let msg = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_owned())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "<non-string panic payload>".to_owned());
        let at = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_default();
        log::error!("panic in thread '{name}' at {at}: {msg}");
        log::logger().flush();
        default_hook(info);
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_hook();
    let result = tauri::Builder::default()
        // Must be registered first: a second launch focuses the running instance and exits.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window::show_main(app);
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(1_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        // Explicit name: the uninstaller hook (src-tauri/windows/hooks.nsh) removes this value.
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Mixdeck")
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(hotkeys::on_shortcut)
                .build(),
        )
        .plugin(
            // Size/position/maximized only. Visibility is ours (first-paint reveal, start
            // minimized), so the plugin must never show the window.
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .manage(settings::SettingsState::default())
        .manage(window::RevealState::default())
        .manage(tray::TrayState::default())
        .manage(hotkeys::HotkeysState::default())
        .setup(|app| {
            let handle = app.handle();
            log::info!(
                "Mixdeck {} starting ({} build, {} {})",
                handle.package_info().version,
                if cfg!(debug_assertions) {
                    "debug"
                } else {
                    "release"
                },
                std::env::consts::OS,
                std::env::consts::ARCH,
            );
            let loaded = settings::load(handle);
            log::info!("settings loaded: {loaded:?}");
            if let Err(e) = app.state::<settings::SettingsState>().replace(loaded) {
                log::warn!("couldn't apply loaded settings: {e}");
            }
            tray::init(handle)?;
            window::init(handle);
            engine::init(handle)?;
            let apps = app
                .state::<settings::SettingsState>()
                .get()
                .map(|s| s.apps)
                .unwrap_or_default();
            sessions::init(handle, apps);
            presets::init(handle);
            hotkeys::init(handle);
            Ok(())
        })
        .on_window_event(window::on_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::app_ready,
            commands::quit_app,
            commands::get_settings,
            commands::set_settings,
            commands::set_param,
            commands::set_script,
            commands::get_state,
            commands::subscribe_group,
            commands::unsubscribe_group,
            commands::refresh_group,
            commands::start_levels,
            commands::launch_voicemeeter,
            commands::restart_audio_engine,
            commands::retry_connection,
            commands::get_engine_info,
            commands::set_demo_mode,
            commands::simulate,
            commands::list_presets,
            commands::save_preset,
            commands::load_preset,
            commands::rename_preset,
            commands::delete_preset,
            commands::open_presets_folder,
            commands::export_vm_xml,
            commands::import_vm_xml,
            commands::get_hotkey_status,
            commands::set_hotkeys_paused,
            commands::check_hotkey,
            commands::get_about_info,
            commands::open_log_folder,
            commands::get_sessions,
            commands::set_app_volume,
            commands::set_app_mute,
            commands::start_app_levels,
            commands::rescan_sessions,
            commands::open_sound_settings,
            commands::simulate_sessions,
        ])
        .build(tauri::generate_context!())
        .map(|app| {
            app.run(|handle, event| {
                if let RunEvent::Exit = event {
                    engine::shutdown(handle);
                    sessions::shutdown(handle);
                }
            })
        });

    if let Err(e) = result {
        log::error!("Mixdeck failed to start: {e}");
        eprintln!("Mixdeck failed to start: {e}");
        std::process::exit(1);
    }
}
