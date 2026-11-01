//! App sessions: which apps play into each Voicemeeter virtual input and
//! record from each B bus, via **Windows Core Audio**. The Remote API can't list them
//! (`Strip[i].AppGain/AppMute` are write-only), so this module never touches `vmr/` and runs
//! its own COM thread, separate from the engine worker.
//!
//! - `types`: wire types (ts-rs) and `AppsSettings`.
//! - `mapping`: endpoint → strip/bus table (pure, tested).
//! - `worker`: the thread, its commands and the `SessionsBackend` trait.
//! - `coreaudio`: the real backend. `fake`: `FakeSessions` (`MIXDECK_FAKE`).
//! - `icons`: exe → PNG data URL, bounded cache.

pub mod coreaudio;
pub mod fake;
pub mod icons;
pub mod mapping;
pub mod types;
pub mod worker;

use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::JoinHandle;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::oneshot;

pub use types::{
    AppLevels, AppSession, AppsSettings, EndpointApps, EndpointRule, SessionTarget,
    SessionTargetKind, SessionsFakeEvent, SessionsState, SessionsStatus, SoundSettingsPage,
};
pub use worker::{BackendKind, Command, LevelsSink, StateSink};

pub const EVENT_STATE: &str = "sessions://state";
/// Same switch as the engine's fake backend (any value but empty or `0`).
pub const FAKE_ENV: &str = "MIXDECK_FAKE";
const REPLY_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, thiserror::Error)]
pub enum SessionsError {
    #[error("Windows audio call failed ({context}): {source}")]
    Com {
        context: &'static str,
        #[source]
        source: windows::core::Error,
    },
    #[error("That app isn't playing any more.")]
    UnknownApp,
    #[error("Volume must be between 0 and 1.")]
    InvalidVolume,
    #[error("App sessions are turned off in Settings › Apps.")]
    Disabled,
    #[error("App sessions are unavailable: {0}")]
    Unavailable(String),
    #[error("Only the simulated app sessions can do that.")]
    NotFake,
    #[error("{0}")]
    Simulation(String),
}

/// Managed state: a handle to the sessions worker.
pub struct Sessions {
    tx: Sender<Command>,
    snapshot: Arc<RwLock<SessionsState>>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Sessions {
    pub fn spawn(
        sink: impl StateSink,
        kind: BackendKind,
        settings: AppsSettings,
    ) -> std::io::Result<Self> {
        let (tx, rx) = mpsc::channel();
        let snapshot = Arc::new(RwLock::new(SessionsState {
            fake: kind == BackendKind::Fake,
            ..Default::default()
        }));
        let snap = snapshot.clone();
        let thread = std::thread::Builder::new()
            .name("mixdeck-sessions".into())
            .spawn(move || worker::thread_main(rx, Box::new(sink), snap, kind, settings))?;
        Ok(Self {
            tx,
            snapshot,
            thread: Mutex::new(Some(thread)),
        })
    }

    pub fn send(&self, cmd: Command) -> Result<(), String> {
        self.tx
            .send(cmd)
            .map_err(|_| "App sessions have stopped. Restart Mixdeck.".to_owned())
    }

    pub async fn request<T>(
        &self,
        make: impl FnOnce(worker::Reply<T>) -> Command,
    ) -> Result<T, String> {
        let (tx, rx) = oneshot::channel();
        self.send(make(Some(tx)))?;
        match tokio::time::timeout(REPLY_TIMEOUT, rx).await {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => Err("App sessions dropped the request. Try again.".into()),
            Err(_) => Err("App sessions didn't answer in time. Try again.".into()),
        }
    }

    /// Latest state, no round trip.
    pub fn state(&self) -> SessionsState {
        self.snapshot.read().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn set_background(&self, background: bool) {
        let _ = self.send(Command::SetBackground(background));
    }

    pub fn configure(&self, settings: AppsSettings) {
        if let Err(e) = self.send(Command::Configure(settings)) {
            log::warn!("sessions: {e}");
        }
    }

    pub fn shutdown(&self) {
        let _ = self.tx.send(Command::Shutdown);
        if let Ok(mut g) = self.thread.lock()
            && let Some(h) = g.take()
        {
            let _ = h.join();
        }
    }
}

/// Backend chosen from `MIXDECK_FAKE`.
pub fn kind_from_env() -> BackendKind {
    match std::env::var(FAKE_ENV) {
        Ok(v) if !v.trim().is_empty() && v.trim() != "0" => BackendKind::Fake,
        _ => BackendKind::Real,
    }
}

struct TauriSink<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> StateSink for TauriSink<R> {
    fn state(&self, s: &SessionsState) {
        if let Err(e) = self.app.emit(EVENT_STATE, s) {
            log::warn!("sessions: couldn't emit {EVENT_STATE}: {e}");
        }
    }
}

/// Starts the worker and registers it as managed state. Call from `setup`, after settings load.
/// Failing to start never fails the app: the module just isn't there (commands report it).
pub fn init<R: Runtime>(app: &AppHandle<R>, settings: AppsSettings) {
    let kind = kind_from_env();
    if kind == BackendKind::Fake {
        log::info!("sessions: {FAKE_ENV} set, using simulated app sessions");
    }
    match Sessions::spawn(TauriSink { app: app.clone() }, kind, settings) {
        Ok(s) => {
            // Starts in the background like the engine: the window is hidden until revealed.
            s.set_background(true);
            app.manage(s);
        }
        Err(e) => log::error!("sessions: couldn't start the worker: {e}"),
    }
}

/// Stops the worker (releases COM). Call on `RunEvent::Exit`.
pub fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    if let Some(s) = app.try_state::<Sessions>() {
        s.shutdown();
    }
}

/// Follows the window's background signal (see `window.rs`): peaks stop, scans slow down.
pub fn set_background<R: Runtime>(app: &AppHandle<R>, background: bool) {
    if let Some(s) = app.try_state::<Sessions>() {
        s.set_background(background);
    }
}

/// Settings › Apps changed.
pub fn apply_settings<R: Runtime>(app: &AppHandle<R>, settings: &AppsSettings) {
    if let Some(s) = app.try_state::<Sessions>() {
        s.configure(settings.clone());
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc::Receiver;
    use std::time::Instant;

    use super::*;

    struct ChanSink(Mutex<Sender<SessionsState>>);
    impl StateSink for ChanSink {
        fn state(&self, s: &SessionsState) {
            if let Ok(tx) = self.0.lock() {
                let _ = tx.send(s.clone());
            }
        }
    }

    fn start(settings: AppsSettings) -> (Sessions, Receiver<SessionsState>) {
        let (tx, rx) = mpsc::channel();
        let s = Sessions::spawn(ChanSink(Mutex::new(tx)), BackendKind::Fake, settings).unwrap();
        (s, rx)
    }

    fn next_ready(rx: &Receiver<SessionsState>) -> SessionsState {
        let until = Instant::now() + Duration::from_secs(3);
        loop {
            let s = rx
                .recv_timeout(until - Instant::now())
                .expect("state event");
            if s.status != SessionsStatus::Starting {
                return s;
            }
        }
    }

    fn names(s: &SessionsState, t: SessionTarget) -> Vec<String> {
        s.endpoints
            .iter()
            .find(|e| e.target == t)
            .map(|e| e.apps.iter().map(|a| a.name.clone()).collect())
            .unwrap_or_default()
    }

    fn block<T>(s: &Sessions, make: impl FnOnce(worker::Reply<T>) -> Command) -> Result<T, String> {
        let (tx, rx) = oneshot::channel();
        s.send(make(Some(tx))).unwrap();
        rx.blocking_recv().unwrap()
    }

    #[test]
    fn fake_seed_matches_the_spec() {
        let (s, rx) = start(AppsSettings::default());
        let st = next_ready(&rx);
        assert!(st.fake);
        assert_eq!(st.status, SessionsStatus::Ready);
        assert_eq!(st.endpoints.len(), 6);
        assert_eq!(
            names(&st, SessionTarget::strip(5)),
            ["Google Chrome", "Spotify"]
        );
        assert_eq!(names(&st, SessionTarget::strip(6)), ["Discord"]);
        assert!(names(&st, SessionTarget::strip(7)).is_empty());
        assert_eq!(names(&st, SessionTarget::bus(5)), ["OBS Studio"]);
        assert!(st.endpoints.iter().all(|e| e.found && e.endpoint.is_some()));
        let app = &st.endpoints[0].apps[0];
        assert!(
            app.icon
                .as_deref()
                .is_some_and(|i| i.starts_with("data:image/png;base64,"))
        );
        assert_eq!(s.state(), st);
        s.shutdown();
    }

    #[test]
    fn keys_are_stable_and_unique() {
        let (s, rx) = start(AppsSettings::default());
        let a = next_ready(&rx);
        block(&s, Command::Rescan).unwrap();
        let b = s.state();
        let keys = |st: &SessionsState| -> Vec<String> {
            st.endpoints
                .iter()
                .flat_map(|e| e.apps.iter().map(|a| a.key.clone()))
                .collect()
        };
        assert_eq!(keys(&a), keys(&b));
        let mut k = keys(&a);
        k.sort();
        k.dedup();
        assert_eq!(k.len(), keys(&a).len());
        assert!(k.iter().all(|k| k.len() == 16));
        s.shutdown();
    }

    #[test]
    fn session_key_is_deterministic() {
        // FNV-1a 64 reference values.
        assert_eq!(types::session_key(""), "cbf29ce484222325");
        assert_eq!(types::session_key("a"), "af63dc4c8601ec8c");
        assert_eq!(types::session_key("x|1"), types::session_key("x|1"));
        assert_ne!(types::session_key("x|1"), types::session_key("x|2"));
    }

    #[test]
    fn volume_and_mute_round_trip_and_emit() {
        let (s, rx) = start(AppsSettings::default());
        let st = next_ready(&rx);
        let key = st.endpoints[1].apps[0].key.clone(); // Discord
        let k = key.clone();
        block(&s, |reply| Command::SetVolume {
            key: k,
            volume: 0.25,
            reply,
        })
        .unwrap();
        let k = key.clone();
        block(&s, |reply| Command::SetMute {
            key: k,
            muted: true,
            reply,
        })
        .unwrap();
        let now = s.state();
        let app = now.find_app(&key).unwrap();
        assert_eq!(app.volume, 0.25);
        assert!(app.muted);
        assert!(now.rev > st.rev);
        // A rescan keeps the values (the backend holds them, like Windows does).
        block(&s, Command::Rescan).unwrap();
        assert!(s.state().find_app(&key).unwrap().muted);
        let k = key.clone();
        let err = block(&s, |reply| Command::SetVolume {
            key: k,
            volume: 1.5,
            reply,
        })
        .unwrap_err();
        assert!(err.contains("between 0 and 1"));
        let err = block(&s, |reply| Command::SetMute {
            key: "nope".into(),
            muted: true,
            reply,
        })
        .unwrap_err();
        assert!(err.contains("isn't playing"));
        s.shutdown();
    }

    #[test]
    fn simulate_adds_and_removes_apps() {
        let (s, rx) = start(AppsSettings::default());
        next_ready(&rx);
        block(&s, |reply| Command::Simulate {
            event: SessionsFakeEvent::AddApp,
            reply,
        })
        .unwrap();
        assert_eq!(
            names(&s.state(), SessionTarget::strip(7)),
            ["VLC media player"]
        );
        block(&s, |reply| Command::Simulate {
            event: SessionsFakeEvent::RemoveApp,
            reply,
        })
        .unwrap();
        assert!(names(&s.state(), SessionTarget::strip(7)).is_empty());
        s.shutdown();
    }

    #[test]
    fn system_sounds_follow_the_setting_and_disable_works() {
        let (s, rx) = start(AppsSettings {
            show_system_sounds: true,
            ..Default::default()
        });
        let st = next_ready(&rx);
        assert!(names(&st, SessionTarget::strip(5)).contains(&"System sounds".to_owned()));
        s.configure(AppsSettings {
            enabled: false,
            ..Default::default()
        });
        let until = Instant::now() + Duration::from_secs(3);
        let off = loop {
            let st = rx.recv_timeout(until - Instant::now()).unwrap();
            if st.status == SessionsStatus::Disabled {
                break st;
            }
        };
        assert!(off.endpoints.is_empty());
        let err = block(&s, |reply| Command::SetMute {
            key: "x".into(),
            muted: true,
            reply,
        })
        .unwrap_err();
        assert!(err.contains("turned off"));
        s.shutdown();
    }

    #[test]
    fn peaks_flow_only_in_the_foreground() {
        let (s, rx) = start(AppsSettings::default());
        next_ready(&rx);
        let (ptx, prx) = mpsc::channel::<AppLevels>();
        s.send(Command::StartLevels(Box::new(move |l: &AppLevels| {
            ptx.send(l.clone()).is_ok()
        })))
        .unwrap();
        // Spawned in the background (as `init` does): nothing yet.
        s.set_background(true);
        assert!(prx.recv_timeout(Duration::from_millis(300)).is_err());
        s.set_background(false);
        let mut frames = Vec::new();
        while frames.len() < 5 {
            frames.push(prx.recv_timeout(Duration::from_secs(2)).expect("peaks"));
        }
        let spotify = s.state().endpoints[0]
            .apps
            .iter()
            .find(|a| a.name == "Spotify")
            .unwrap()
            .key
            .clone();
        let vals: Vec<f32> = frames
            .iter()
            .filter_map(|f| f.peaks.iter().find(|(k, _)| *k == spotify).map(|(_, p)| *p))
            .collect();
        assert!(vals.iter().all(|p| (0.0..=1.0).contains(p)));
        assert!(vals.iter().any(|p| *p > 0.0), "music is playing");
        assert!(vals.windows(2).any(|w| w[0] != w[1]), "peaks move");
        s.set_background(true);
        std::thread::sleep(Duration::from_millis(150));
        while prx.try_recv().is_ok() {}
        assert!(
            prx.recv_timeout(Duration::from_millis(300)).is_err(),
            "stopped in background"
        );
        s.shutdown();
    }
}
