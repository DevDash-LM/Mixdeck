//! The sessions worker: one thread (`mixdeck-sessions`, COM MTA) owns the backend. It rescans
//! about once a second (every 5 s in the background), reads per-app peaks about 15×/s only in
//! the foreground while a channel is open, and handles commands as they arrive.
//! Nothing here touches `vmr/` or the engine worker.

use std::collections::VecDeque;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use tokio::sync::oneshot;

use super::SessionsError;
use super::fake::FakeSessions;
use super::mapping::Mapping;
use super::types::{
    AppLevels, AppsSettings, EndpointApps, SessionsFakeEvent, SessionsState, SessionsStatus,
};

pub const SCAN_FOREGROUND: Duration = Duration::from_millis(1000);
pub const SCAN_BACKGROUND: Duration = Duration::from_secs(5);
pub const PEAK_EVERY: Duration = Duration::from_millis(66);
/// After Windows audio failed, try to set it up again this often.
pub const RETRY_BACKEND: Duration = Duration::from_secs(10);
/// Peaks below this count as silence (a silent frame is sent once, then nothing).
const SILENCE: f32 = 1e-4;

/// What a scan should include.
#[derive(Debug, Clone, Copy, Default)]
pub struct ScanOptions {
    pub show_system: bool,
}

/// Where sessions come from: Windows (`CoreAudio`) or `FakeSessions`. Created on, and never
/// leaves, the worker thread.
pub trait SessionsBackend {
    fn is_fake(&self) -> bool;
    /// The six targets in `mapping::TARGETS` order.
    fn scan(
        &mut self,
        mapping: &Mapping,
        opts: &ScanOptions,
    ) -> Result<Vec<EndpointApps>, SessionsError>;
    /// Peaks (linear 0..1) for the sessions of the last scan.
    fn peaks(&mut self, out: &mut Vec<(String, f32)>);
    fn set_volume(&mut self, key: &str, volume: f32) -> Result<(), SessionsError>;
    fn set_mute(&mut self, key: &str, muted: bool) -> Result<(), SessionsError>;
    fn simulate(&mut self, _event: SessionsFakeEvent) -> Result<(), SessionsError> {
        Err(SessionsError::NotFake)
    }
}

pub type Reply<T> = Option<oneshot::Sender<Result<T, String>>>;
/// Receives peak frames; returns false when the receiver is gone.
pub type LevelsSink = Box<dyn FnMut(&AppLevels) -> bool + Send>;

/// Where the worker sends state changes.
pub trait StateSink: Send + 'static {
    fn state(&self, s: &SessionsState);
}

pub enum Command {
    SetVolume {
        key: String,
        volume: f32,
        reply: Reply<()>,
    },
    SetMute {
        key: String,
        muted: bool,
        reply: Reply<()>,
    },
    StartLevels(LevelsSink),
    /// Scan now (and retry Windows audio if it had failed). Replies after the scan.
    Rescan(Reply<()>),
    SetBackground(bool),
    Configure(AppsSettings),
    Simulate {
        event: SessionsFakeEvent,
        reply: Reply<()>,
    },
    Shutdown,
}

fn send_reply<T>(reply: Reply<T>, v: Result<T, String>) {
    if let Some(tx) = reply {
        let _ = tx.send(v);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackendKind {
    Real,
    Fake,
}

/// State that survives a worker restart after a panic.
struct Persist {
    settings: AppsSettings,
    background: bool,
    levels: Option<LevelsSink>,
}

/// Thread body.
pub fn thread_main(
    rx: Receiver<Command>,
    sink: Box<dyn StateSink>,
    snapshot: Arc<RwLock<SessionsState>>,
    kind: BackendKind,
    settings: AppsSettings,
) {
    // COM lives as long as the thread, outside the unwind boundary.
    let com = match kind {
        BackendKind::Fake => Ok(None),
        BackendKind::Real => super::coreaudio::ComGuard::init_mta().map(Some),
    };
    let com_error = com.as_ref().err().map(|e| e.to_string());
    if let Some(e) = &com_error {
        log::error!("sessions: {e}");
    }
    let mut persist = Persist {
        settings,
        background: true,
        levels: None,
    };
    let mut panics: VecDeque<Instant> = VecDeque::new();
    loop {
        let result = catch_unwind(AssertUnwindSafe(|| {
            let mut w = Worker::new(&*sink, &snapshot, kind, com_error.clone(), &mut persist);
            w.run(&rx);
        }));
        match result {
            Ok(()) => break,
            Err(_) => {
                // The panic hook already logged the details.
                let now = Instant::now();
                panics.push_back(now);
                while panics
                    .front()
                    .is_some_and(|t| now - *t > Duration::from_secs(10))
                {
                    panics.pop_front();
                }
                log::error!("sessions: worker panicked; restarting");
                if panics.len() > 3 {
                    std::thread::sleep(Duration::from_secs(2));
                }
            }
        }
    }
    drop(com);
}

struct Worker<'a> {
    sink: &'a dyn StateSink,
    snapshot: &'a RwLock<SessionsState>,
    kind: BackendKind,
    com_error: Option<String>,
    p: &'a mut Persist,
    backend: Option<Box<dyn SessionsBackend>>,
    mapping: Mapping,
    state: SessionsState,
    next_scan: Instant,
    next_peak: Instant,
    next_backend_try: Instant,
    peaks: Vec<(String, f32)>,
    last_peaks_loud: bool,
}

impl<'a> Worker<'a> {
    fn new(
        sink: &'a dyn StateSink,
        snapshot: &'a RwLock<SessionsState>,
        kind: BackendKind,
        com_error: Option<String>,
        p: &'a mut Persist,
    ) -> Self {
        let now = Instant::now();
        let state = snapshot.read().map(|s| s.clone()).unwrap_or_default();
        let mapping = Mapping::new(&p.settings.endpoint_rules);
        Self {
            sink,
            snapshot,
            kind,
            com_error,
            p,
            backend: None,
            mapping,
            state,
            next_scan: now,
            next_peak: now,
            next_backend_try: now,
            peaks: Vec::new(),
            last_peaks_loud: false,
        }
    }

    fn run(&mut self, rx: &Receiver<Command>) {
        loop {
            let wait = self
                .next_deadline()
                .saturating_duration_since(Instant::now());
            match rx.recv_timeout(wait) {
                Ok(Command::Shutdown) | Err(RecvTimeoutError::Disconnected) => return,
                Ok(cmd) => self.handle(cmd),
                Err(RecvTimeoutError::Timeout) => {}
            }
            self.tick();
        }
    }

    fn peaks_wanted(&self) -> bool {
        self.p.levels.is_some() && !self.p.background && self.p.settings.enabled
    }

    fn next_deadline(&self) -> Instant {
        if self.peaks_wanted() {
            self.next_scan.min(self.next_peak)
        } else {
            self.next_scan
        }
    }

    fn tick(&mut self) {
        let now = Instant::now();
        if now >= self.next_scan {
            self.scan();
        }
        if self.peaks_wanted() && now >= self.next_peak {
            self.next_peak = now + PEAK_EVERY;
            self.send_peaks();
        }
    }

    fn handle(&mut self, cmd: Command) {
        match cmd {
            Command::Shutdown => {}
            Command::SetVolume { key, volume, reply } => {
                let r = if volume.is_finite() && (0.0..=1.0).contains(&volume) {
                    self.with_backend(|b| b.set_volume(&key, volume))
                } else {
                    Err(SessionsError::InvalidVolume)
                };
                if r.is_ok() {
                    self.patch(&key, |a| a.volume = volume);
                }
                send_reply(reply, r.map_err(|e| e.to_string()));
            }
            Command::SetMute { key, muted, reply } => {
                let r = self.with_backend(|b| b.set_mute(&key, muted));
                if r.is_ok() {
                    self.patch(&key, |a| a.muted = muted);
                }
                send_reply(reply, r.map_err(|e| e.to_string()));
            }
            Command::StartLevels(sink) => {
                self.p.levels = Some(sink);
                self.next_peak = Instant::now();
            }
            Command::Rescan(reply) => {
                self.next_backend_try = Instant::now();
                self.scan();
                let r = match self.state.status {
                    SessionsStatus::Unavailable => Err(self
                        .state
                        .error
                        .clone()
                        .unwrap_or_else(|| "Windows audio sessions are unavailable.".into())),
                    _ => Ok(()),
                };
                send_reply(reply, r);
            }
            Command::SetBackground(bg) => {
                if self.p.background != bg {
                    self.p.background = bg;
                    if !bg {
                        // Fresh list as soon as the window comes back.
                        self.next_scan = Instant::now();
                    }
                }
            }
            Command::Configure(settings) => {
                self.mapping = Mapping::new(&settings.endpoint_rules);
                self.p.settings = settings;
                self.next_scan = Instant::now();
            }
            Command::Simulate { event, reply } => {
                let r = self.with_backend(|b| b.simulate(event));
                if r.is_ok() {
                    self.scan();
                }
                send_reply(reply, r.map_err(|e| e.to_string()));
            }
        }
    }

    fn with_backend<T>(
        &mut self,
        f: impl FnOnce(&mut dyn SessionsBackend) -> Result<T, SessionsError>,
    ) -> Result<T, SessionsError> {
        if !self.p.settings.enabled {
            return Err(SessionsError::Disabled);
        }
        match self.backend.as_deref_mut() {
            Some(b) => f(b),
            None => Err(SessionsError::Unavailable(
                self.state
                    .error
                    .clone()
                    .unwrap_or_else(|| "not started yet".into()),
            )),
        }
    }

    fn ensure_backend(&mut self) -> Result<(), String> {
        if self.backend.is_some() {
            return Ok(());
        }
        if let Some(e) = &self.com_error {
            return Err(e.clone());
        }
        let now = Instant::now();
        if now < self.next_backend_try {
            return Err(self.state.error.clone().unwrap_or_default());
        }
        self.next_backend_try = now + RETRY_BACKEND;
        let made: Result<Box<dyn SessionsBackend>, SessionsError> = match self.kind {
            BackendKind::Fake => Ok(Box::new(FakeSessions::new())),
            BackendKind::Real => super::coreaudio::CoreAudio::new().map(|b| Box::new(b) as _),
        };
        match made {
            Ok(b) => {
                log::info!(
                    "sessions: watching {} audio sessions",
                    if b.is_fake() { "simulated" } else { "Windows" }
                );
                self.backend = Some(b);
                Ok(())
            }
            Err(e) => {
                log::warn!("sessions: unavailable: {e}");
                Err(e.to_string())
            }
        }
    }

    fn scan(&mut self) {
        let now = Instant::now();
        self.next_scan = now
            + if self.p.background {
                SCAN_BACKGROUND
            } else {
                SCAN_FOREGROUND
            };
        if !self.p.settings.enabled {
            self.backend = None; // release COM objects while off
            self.publish(SessionsStatus::Disabled, Vec::new(), None);
            return;
        }
        if let Err(e) = self.ensure_backend() {
            self.publish(SessionsStatus::Unavailable, Vec::new(), Some(e));
            return;
        }
        let opts = ScanOptions {
            show_system: self.p.settings.show_system_sounds,
        };
        let Some(b) = self.backend.as_deref_mut() else {
            return;
        };
        match b.scan(&self.mapping, &opts) {
            Ok(eps) => self.publish(SessionsStatus::Ready, eps, None),
            Err(e) => {
                log::warn!("sessions: scan failed, will retry: {e}");
                self.backend = None;
                self.next_backend_try = now + RETRY_BACKEND;
                self.publish(SessionsStatus::Unavailable, Vec::new(), Some(e.to_string()));
            }
        }
    }

    fn publish(
        &mut self,
        status: SessionsStatus,
        endpoints: Vec<EndpointApps>,
        error: Option<String>,
    ) {
        let fake = self.kind == BackendKind::Fake;
        let s = &self.state;
        if s.rev != 0
            && s.status == status
            && s.endpoints == endpoints
            && s.error == error
            && s.fake == fake
        {
            return;
        }
        let next = SessionsState {
            endpoints,
            rev: s.rev + 1,
            status,
            error,
            fake,
        };
        self.commit(next);
    }

    fn patch(&mut self, key: &str, f: impl FnOnce(&mut super::types::AppSession)) {
        let mut next = self.state.clone();
        if let Some(a) = next.find_app_mut(key) {
            f(a);
            if next != self.state {
                next.rev += 1;
                self.commit(next);
            }
        }
    }

    fn commit(&mut self, next: SessionsState) {
        if let Ok(mut g) = self.snapshot.write() {
            *g = next.clone();
        }
        self.sink.state(&next);
        self.state = next;
    }

    fn send_peaks(&mut self) {
        let Some(b) = self.backend.as_deref_mut() else {
            return;
        };
        b.peaks(&mut self.peaks);
        let loud = self.peaks.iter().any(|(_, p)| *p > SILENCE);
        if !loud && !self.last_peaks_loud {
            return;
        }
        self.last_peaks_loud = loud;
        let frame = AppLevels {
            peaks: self.peaks.clone(),
        };
        if let Some(sink) = self.p.levels.as_mut()
            && !sink(&frame)
        {
            self.p.levels = None;
        }
    }
}
