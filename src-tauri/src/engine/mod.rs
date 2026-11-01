//! The engine: one worker thread owns the backend (every DLL call happens there), runs the
//! ~60 Hz loop, drives the connection state machine, reads param groups and pushes levels.
//!
//! The rest of the app talks to it through [`Engine`] (a command queue plus a state snapshot)
//! and hears from it through a [`Sink`] (Tauri events in the app, a recorder in tests).

pub mod backend;
pub mod fake;
pub mod groups;
pub mod state;
mod tauri_sink;

use std::collections::BTreeMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use tokio::sync::oneshot;

use crate::vmr::{self, LevelKind, LoginStatus, RunKind, VmType, VmrError, layout, params};

use backend::{OpenError, RealBackend, VmBackend};
use fake::{FakeBackend, FakeStart};
use groups::ParamGroup;
use state::{
    BackendKind, ConnectionState, EngineInfo, FakeEvent, GroupEvent, Levels, MixerState, ParamValue,
};

pub use tauri_sink::{init, shutdown};

/// Loop period (~60 Hz).
const TICK: Duration = Duration::from_micros(16_667);
/// Tick period while the window is hidden/minimized or Voicemeeter isn't connected: no meters
/// are drawn, so only the dirty flag (hotkeys and the tray read the snapshot) and the
/// connection poll need to run. Commands are still handled the moment they arrive.
const TICK_IDLE: Duration = Duration::from_millis(100);
/// How often to look for Voicemeeter while disconnected.
const POLL_DISCONNECTED: Duration = Duration::from_millis(1000);
/// How often to retry DLL discovery while it isn't found.
const RETRY_DISCOVERY: Duration = Duration::from_secs(10);
/// A tick slower than this is logged (rate-limited).
const SLOW_TICK: Duration = Duration::from_millis(2);
/// How long a command waits for the worker before giving up.
const REPLY_TIMEOUT: Duration = Duration::from_secs(3);
/// Env var that selects the fake backend (`1`, `offline`, `banana`, `missing`; `0`/empty = real).
pub const FAKE_ENV: &str = "MIXDECK_FAKE";

/// Where the engine sends what it observes.
pub trait Sink: Send + 'static {
    fn state(&self, s: &MixerState);
    fn group(&self, ev: &GroupEvent);
    fn connection(&self, c: &ConnectionState);
    /// Current meter tap (0 pre-fader, 1 post-fader, 2 post-mute). Read about twice a second.
    fn meter_mode(&self) -> u8;
}

/// Receives level frames; returns false when the receiver is gone.
pub type LevelsSink = Box<dyn FnMut(&Levels) -> bool + Send>;

type Reply<T> = Option<oneshot::Sender<Result<T, String>>>;

/// Requests to the worker.
pub enum Command {
    SetParam {
        name: String,
        value: ParamValue,
        reply: Reply<()>,
    },
    SetScript {
        script: String,
        reply: Reply<()>,
    },
    Subscribe {
        id: String,
        reply: Reply<()>,
    },
    Unsubscribe {
        id: String,
    },
    /// Re-reads a subscribed group now (e.g. the device list, which can change without a dirty
    /// flag). Emits `mixer://group` only if the data changed; replies once the read is done.
    RefreshGroup {
        id: String,
        reply: Reply<()>,
    },
    StartLevels(LevelsSink),
    /// The window is hidden or minimized (`true`) or visible again (`false`). In the background
    /// no levels are read or pushed and the loop ticks at `TICK_IDLE`.
    SetBackground(bool),
    Launch {
        reply: Reply<()>,
    },
    RestartAudio {
        reply: Reply<()>,
    },
    Retry,
    SetDemo {
        enabled: bool,
        reply: Reply<EngineInfo>,
    },
    Simulate {
        event: FakeEvent,
        reply: Reply<()>,
    },
    /// Reads many params in one go. A param this Voicemeeter build
    /// doesn't know (or a non-finite float) comes back as `None`.
    ReadParams {
        params: Vec<(String, ParamKind)>,
        reply: Reply<Vec<Option<ParamValue>>>,
    },
    /// Applies several scripts, then `set_string`s, in one go. Each
    /// script is atomic; a failing one is reported and the rest still run.
    ApplyBatch {
        scripts: Vec<String>,
        strings: Vec<(String, String)>,
        reply: Reply<Vec<BatchFailure>>,
    },
    Shutdown,
}

/// How to read a param for [`Command::ReadParams`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParamKind {
    Float,
    String,
}

/// One failed step of [`Command::ApplyBatch`].
#[derive(Debug, Clone, PartialEq)]
pub enum BatchFailure {
    /// `scripts[script]` was rejected; `line` is 1-based when Voicemeeter named one.
    Script {
        script: usize,
        line: Option<usize>,
        message: String,
    },
    /// `set_string(name, …)` failed.
    String { name: String, message: String },
}

/// Startup options.
#[derive(Debug, Clone, Copy, Default)]
pub struct Options {
    /// `Some` = start on the fake backend (from `MIXDECK_FAKE`).
    pub fake: Option<FakeStart>,
}

impl Options {
    pub fn from_env() -> Self {
        let fake = std::env::var(FAKE_ENV)
            .ok()
            .filter(|v| !v.trim().is_empty() && v.trim() != "0")
            .map(|v| FakeStart::from_env_value(&v));
        Self { fake }
    }
}

/// Handle to the running engine (managed Tauri state).
pub struct Engine {
    tx: Mutex<Sender<Command>>,
    snapshot: Arc<RwLock<MixerState>>,
    info: Arc<RwLock<EngineInfo>>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Engine {
    pub fn spawn(sink: impl Sink, opts: Options) -> std::io::Result<Engine> {
        let (tx, rx) = mpsc::channel();
        let snapshot = Arc::new(RwLock::new(MixerState::default()));
        let info = Arc::new(RwLock::new(EngineInfo {
            backend: if opts.fake.is_some() {
                BackendKind::Fake
            } else {
                BackendKind::Real
            },
            forced_by_env: opts.fake.is_some(),
            dll_path: None,
        }));
        let (snap2, info2) = (snapshot.clone(), info.clone());
        let thread = std::thread::Builder::new()
            .name("mixdeck-engine".into())
            .spawn(move || worker_main(Worker::new(sink, rx, opts, snap2, info2)))?;
        Ok(Engine {
            tx: Mutex::new(tx),
            snapshot,
            info,
            thread: Mutex::new(Some(thread)),
        })
    }

    /// Fire-and-forget.
    pub fn send(&self, cmd: Command) -> Result<(), String> {
        let tx = self
            .tx
            .lock()
            .map_err(|_| "The audio engine is unavailable.".to_string())?;
        tx.send(cmd)
            .map_err(|_| "The audio engine has stopped. Restart Mixdeck.".to_string())
    }

    /// Sends a command and waits for its reply.
    pub async fn request<T>(&self, make: impl FnOnce(Reply<T>) -> Command) -> Result<T, String> {
        let (tx, rx) = oneshot::channel();
        self.send(make(Some(tx)))?;
        match tokio::time::timeout(REPLY_TIMEOUT, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("The audio engine dropped the request. Try again.".into()),
            Err(_) => Err("The audio engine didn't answer in time. Try again.".into()),
        }
    }

    /// Window hidden/minimized → pause meters and slow the loop (see `Command::SetBackground`).
    pub fn set_background(&self, background: bool) {
        if let Err(e) = self.send(Command::SetBackground(background)) {
            log::warn!("engine: couldn't change background mode: {e}");
        }
    }

    /// Latest Mixer state (no round trip to the worker).
    pub fn state(&self) -> MixerState {
        self.snapshot.read().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn info(&self) -> EngineInfo {
        self.info.read().map(|i| i.clone()).unwrap_or(EngineInfo {
            backend: BackendKind::Real,
            forced_by_env: false,
            dll_path: None,
        })
    }

    /// Stops the worker and waits up to 2 s for it (it logs out of the DLL on the way out).
    pub fn shutdown(&self) {
        let _ = self.send(Command::Shutdown);
        let handle = self.thread.lock().ok().and_then(|mut t| t.take());
        if let Some(h) = handle {
            let deadline = Instant::now() + Duration::from_secs(2);
            while !h.is_finished() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(10));
            }
            if h.is_finished() {
                let _ = h.join();
                log::info!("engine: stopped");
            } else {
                log::warn!("engine: worker didn't stop within 2 s; exiting anyway");
            }
        }
    }
}

/// Runs the worker, restarting it after a panic. The backend lives in `worker`, outside the
/// unwind, so a panic never drops it (which would log out, and Login can't be called again).
fn worker_main<S: Sink>(mut worker: Worker<S>) {
    let mut panics: Vec<Instant> = Vec::new();
    loop {
        let result = catch_unwind(AssertUnwindSafe(|| worker.run()));
        match result {
            Ok(()) => break,
            Err(payload) => {
                let msg = payload
                    .downcast_ref::<&str>()
                    .map(|s| (*s).to_owned())
                    .or_else(|| payload.downcast_ref::<String>().cloned())
                    .unwrap_or_else(|| "unknown panic".into());
                log::error!("engine: worker panicked ({msg}); restarting it");
                let now = Instant::now();
                panics.retain(|t| now.duration_since(*t) < Duration::from_secs(10));
                panics.push(now);
                if panics.len() > 3 {
                    std::thread::sleep(Duration::from_secs(2));
                }
                worker.recover();
            }
        }
    }
}

struct Sub {
    group: Box<dyn ParamGroup>,
    last: Option<GroupEvent>,
}

/// Picks the active backend as a `&mut dyn VmBackend`, borrowing only the backend fields so the
/// rest of `self` stays usable.
macro_rules! backend {
    ($self:ident) => {
        if $self.use_fake {
            $self.fake.as_deref_mut()
        } else {
            $self.real.as_deref_mut()
        }
    };
}

pub(crate) struct Worker<S: Sink> {
    sink: S,
    rx: Receiver<Command>,
    running: bool,

    real: Option<Box<dyn VmBackend>>,
    /// Set once real discovery ends in a state that can't be retried (Login failed).
    real_final: Option<ConnectionState>,
    fake: Option<Box<dyn VmBackend>>,
    use_fake: bool,
    next_discovery: Instant,

    connection: ConnectionState,
    strips_buses: Option<(Vec<state::Strip>, Vec<state::Bus>)>,
    rev: u64,
    subs: BTreeMap<String, Sub>,
    levels: Option<LevelsSink>,
    meter_mode: u8,
    background: bool,

    force_read: bool,
    next_poll: Instant,
    ticks: u64,
    slow_count: u32,
    slow_last_warn: Instant,
    err_last_log: Instant,

    snapshot: Arc<RwLock<MixerState>>,
    info: Arc<RwLock<EngineInfo>>,
}

impl<S: Sink> Worker<S> {
    fn new(
        sink: S,
        rx: Receiver<Command>,
        opts: Options,
        snapshot: Arc<RwLock<MixerState>>,
        info: Arc<RwLock<EngineInfo>>,
    ) -> Self {
        let now = Instant::now();
        let past = now.checked_sub(Duration::from_secs(60)).unwrap_or(now);
        Self {
            sink,
            rx,
            running: true,
            real: None,
            real_final: None,
            fake: opts
                .fake
                .map(|s| Box::new(FakeBackend::new(s)) as Box<dyn VmBackend>),
            use_fake: opts.fake.is_some(),
            next_discovery: now,
            connection: ConnectionState::Starting,
            strips_buses: None,
            rev: 0,
            subs: BTreeMap::new(),
            levels: None,
            meter_mode: 1,
            background: false,
            force_read: true,
            next_poll: now,
            ticks: 0,
            slow_count: 0,
            slow_last_warn: past,
            err_last_log: past,
            snapshot,
            info,
        }
    }

    fn run(&mut self) {
        let mut next = Instant::now();
        while self.running {
            // Handle commands as they arrive until the next tick is due.
            loop {
                let now = Instant::now();
                if now >= next {
                    break;
                }
                match self.rx.recv_timeout(next - now) {
                    Ok(cmd) => self.handle(cmd),
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => self.running = false,
                }
                if !self.running {
                    return;
                }
            }
            let started = Instant::now();
            self.tick(started);
            self.note_tick_time(started.elapsed());
            let period = self.tick_period();
            next += period;
            let now = Instant::now();
            if next < now {
                next = now + period; // fell behind: don't try to catch up
            }
        }
    }

    /// Called after a panic: forget caches so everything is re-read and re-emitted.
    fn recover(&mut self) {
        self.strips_buses = None;
        for sub in self.subs.values_mut() {
            sub.last = None;
        }
        self.force_read = true;
        self.next_poll = Instant::now();
    }

    // ---- Commands ----

    fn handle(&mut self, cmd: Command) {
        match cmd {
            Command::SetParam { name, value, reply } => {
                let r = self.with_connected(|b| match &value {
                    ParamValue::Num(v) => b.set_float(&name, *v),
                    ParamValue::Str(s) => b.set_string(&name, s),
                });
                respond(reply, r);
            }
            Command::SetScript { script, reply } => {
                let r = self.with_connected(|b| b.set_script(&script));
                respond(reply, r);
            }
            Command::Subscribe { id, reply } => {
                let r = self.subscribe(id);
                respond(reply, r);
            }
            Command::Unsubscribe { id } => {
                if self.subs.remove(&id).is_some() {
                    log::info!("engine: unsubscribed `{id}` ({} active)", self.subs.len());
                }
            }
            Command::RefreshGroup { id, reply } => {
                let r = self.refresh_group(&id);
                respond(reply, r);
            }
            Command::StartLevels(sink) => self.levels = Some(sink),
            Command::SetBackground(bg) => {
                if bg != self.background {
                    log::info!(
                        "engine: {}",
                        if bg {
                            "background (meters paused)"
                        } else {
                            "foreground"
                        }
                    );
                    self.background = bg;
                }
            }
            Command::Launch { reply } => {
                let r = self.launch();
                respond(reply, r);
            }
            Command::RestartAudio { reply } => {
                let r = self.with_connected(|b| b.set_float(&params::command::restart(), 1.0));
                if let Err(e) = &r {
                    log::warn!("engine: restart audio engine failed: {e}");
                } else {
                    log::info!("engine: audio engine restart requested");
                }
                respond(reply, r);
            }
            Command::Retry => {
                let now = Instant::now();
                self.next_poll = now;
                self.next_discovery = now;
            }
            Command::SetDemo { enabled, reply } => {
                self.set_demo(enabled);
                let info = self
                    .info
                    .read()
                    .map(|i| i.clone())
                    .map_err(|_| "poisoned".into());
                respond(reply, info);
            }
            Command::Simulate { event, reply } => {
                let r = match backend!(self).and_then(|b| b.as_fake_mut()) {
                    Some(f) => {
                        f.simulate(event);
                        self.next_poll = Instant::now();
                        Ok(())
                    }
                    None => Err("Simulations only work in demo mode.".to_string()),
                };
                respond(reply, r);
            }
            Command::ReadParams { params, reply } => {
                let r = self.read_params(&params);
                respond(reply, r);
            }
            Command::ApplyBatch {
                scripts,
                strings,
                reply,
            } => {
                let r = self.apply_batch(&scripts, &strings);
                respond(reply, r);
            }
            Command::Shutdown => self.running = false,
        }
    }

    fn read_params(
        &mut self,
        params: &[(String, ParamKind)],
    ) -> Result<Vec<Option<ParamValue>>, String> {
        let mut out = Vec::with_capacity(params.len());
        self.with_connected(|b| {
            for (name, kind) in params {
                let v = match kind {
                    ParamKind::Float => b
                        .get_float(name)
                        .map(|v| v.is_finite().then_some(ParamValue::Num(v))),
                    ParamKind::String => b.get_string(name).map(|s| Some(ParamValue::Str(s))),
                };
                match v {
                    Ok(v) => out.push(v),
                    Err(VmrError::NoServer) => return Err(VmrError::NoServer),
                    Err(_) => out.push(None),
                }
            }
            Ok(())
        })?;
        Ok(out)
    }

    fn apply_batch(
        &mut self,
        scripts: &[String],
        strings: &[(String, String)],
    ) -> Result<Vec<BatchFailure>, String> {
        let mut failures = Vec::new();
        self.with_connected(|b| {
            for (i, script) in scripts.iter().enumerate() {
                match b.set_script(script) {
                    Ok(()) => {}
                    Err(VmrError::NoServer) => return Err(VmrError::NoServer),
                    Err(e) => failures.push(BatchFailure::Script {
                        script: i,
                        line: match e {
                            VmrError::ScriptLine(n) if n > 0 => Some(n as usize),
                            _ => None,
                        },
                        message: e.to_string(),
                    }),
                }
            }
            for (name, value) in strings {
                match b.set_string(name, value) {
                    Ok(()) => {}
                    Err(VmrError::NoServer) => return Err(VmrError::NoServer),
                    Err(e) => failures.push(BatchFailure::String {
                        name: name.clone(),
                        message: e.to_string(),
                    }),
                }
            }
            Ok(())
        })?;
        Ok(failures)
    }

    /// Runs `f` against the backend if Voicemeeter is connected; maps errors to messages.
    fn with_connected(
        &mut self,
        f: impl FnOnce(&mut dyn VmBackend) -> Result<(), VmrError>,
    ) -> Result<(), String> {
        if !self.connection.is_connected() {
            return Err("Voicemeeter isn't connected.".into());
        }
        let b = backend!(self).ok_or_else(|| "Voicemeeter isn't connected.".to_string())?;
        f(b).map_err(|e| match e {
            VmrError::NoServer => {
                self.next_poll = Instant::now();
                "Voicemeeter isn't running.".to_string()
            }
            other => other.to_string(),
        })
    }

    fn subscribe(&mut self, id: String) -> Result<(), String> {
        if id == groups::CORE {
            return Ok(());
        }
        if let Some(sub) = self.subs.get(&id) {
            // A view (re)mounted: give it the data we already have.
            if let Some(ev) = &sub.last {
                self.sink.group(ev);
            }
            return Ok(());
        }
        let group = groups::resolve(&id)?;
        self.subs.insert(id.clone(), Sub { group, last: None });
        log::info!("engine: subscribed `{id}` ({} active)", self.subs.len());
        if self.connection.is_connected() {
            // NoServer here is picked up by the next tick's is_dirty.
            let _ = self.read_group(&id);
        }
        Ok(())
    }

    fn refresh_group(&mut self, id: &str) -> Result<(), String> {
        if id == groups::CORE {
            self.force_read = true;
            return Ok(());
        }
        if !self.subs.contains_key(id) {
            return Err(format!("Param group `{id}` isn't subscribed."));
        }
        if !self.connection.is_connected() {
            return Err("Voicemeeter isn't connected.".into());
        }
        if self.read_group(id) == Err(VmrError::NoServer) {
            // The next tick's is_dirty notices and switches to disconnected.
            return Err("Voicemeeter isn't connected.".into());
        }
        Ok(())
    }

    fn launch(&mut self) -> Result<(), String> {
        if self.connection.is_connected() {
            return Ok(());
        }
        let b = backend!(self).ok_or_else(|| match &self.connection {
            ConnectionState::DllNotFound { .. } => "Voicemeeter isn't installed.".to_string(),
            _ => "The Voicemeeter Remote DLL isn't loaded.".to_string(),
        })?;
        b.run_voicemeeter(RunKind::PotatoX64)
            .map_err(|e| e.to_string())?;
        log::info!("engine: asked Voicemeeter Potato to start");
        self.next_poll = Instant::now() + Duration::from_millis(500);
        Ok(())
    }

    fn set_demo(&mut self, enabled: bool) {
        if enabled == self.use_fake {
            return;
        }
        log::info!("engine: demo mode {}", if enabled { "on" } else { "off" });
        if enabled && self.fake.is_none() {
            self.fake = Some(Box::new(FakeBackend::new(FakeStart::Running)));
        }
        self.use_fake = enabled;
        self.strips_buses = None;
        for sub in self.subs.values_mut() {
            sub.last = None;
        }
        self.force_read = true;
        let now = Instant::now();
        self.next_poll = now;
        self.next_discovery = now;
        self.set_connection(ConnectionState::Starting);
        self.update_info();
    }

    fn update_info(&self) {
        let dll_path = self
            .real
            .as_ref()
            .and_then(|r| r.dll_path())
            .map(|p| p.display().to_string());
        if let Ok(mut i) = self.info.write() {
            i.backend = if self.use_fake {
                BackendKind::Fake
            } else {
                BackendKind::Real
            };
            i.dll_path = dll_path;
        }
    }

    // ---- Loop ----

    fn tick_period(&self) -> Duration {
        if self.background || !self.connection.is_connected() {
            TICK_IDLE
        } else {
            TICK
        }
    }

    fn tick(&mut self, now: Instant) {
        if self.ticks.is_multiple_of(30) {
            self.meter_mode = self.sink.meter_mode().min(2);
        }
        self.ticks = self.ticks.wrapping_add(1);
        if self.connection.is_connected() {
            self.connected_tick();
        } else if now >= self.next_poll {
            self.poll_connection(now);
        }
    }

    fn poll_connection(&mut self, now: Instant) {
        self.next_poll = now + POLL_DISCONNECTED;
        if !self.use_fake && self.real.is_none() {
            if let Some(final_state) = self.real_final.clone() {
                self.set_connection(final_state);
                return;
            }
            if now < self.next_discovery {
                return;
            }
            self.next_discovery = now + RETRY_DISCOVERY;
            if let Err(state) = self.discover() {
                self.set_connection(state);
                return;
            }
        }
        let Some(b) = backend!(self) else {
            return;
        };
        let next = match b.vm_type() {
            Ok(VmType::Potato) => {
                let version = b.vm_version().unwrap_or_else(|_| "unknown".into());
                if let Ok(parts) = b.vm_version_parts()
                    && parts < vmr::TARGET_VM_VERSION
                {
                    log::warn!(
                        "engine: Voicemeeter {} is older than the tested {}; some features may not work",
                        vmr::format_version(parts),
                        vmr::format_version(vmr::TARGET_VM_VERSION)
                    );
                }
                ConnectionState::Connected {
                    vm_type: VmType::Potato.into(),
                    version,
                }
            }
            Ok(other) => ConnectionState::WrongEdition {
                vm_type: other.into(),
            },
            Err(VmrError::NoServer) => ConnectionState::NotRunning,
            // Only the fake backend's `missing` mode reports this here.
            Err(VmrError::DllNotFound { searched }) => ConnectionState::DllNotFound {
                searched: searched.iter().map(|p| p.display().to_string()).collect(),
            },
            Err(e) => {
                self.log_error(&format!("checking Voicemeeter failed: {e}"));
                ConnectionState::NotRunning
            }
        };
        let connected = next.is_connected();
        if connected {
            self.force_read = true;
            self.strips_buses = None;
            for sub in self.subs.values_mut() {
                sub.last = None;
            }
        }
        self.set_connection(next);
        if connected {
            // Read straight away so the Mixer fills in on the same tick.
            self.connected_tick();
        }
    }

    /// Finds, loads and logs in to the real DLL (Login happens at most once per process).
    fn discover(&mut self) -> Result<(), ConnectionState> {
        let path = vmr::locate_dll().map_err(|e| match e {
            VmrError::DllNotFound { searched } => ConnectionState::DllNotFound {
                searched: searched.iter().map(|p| p.display().to_string()).collect(),
            },
            other => ConnectionState::DllError {
                message: other.to_string(),
            },
        })?;
        match RealBackend::open(&path) {
            Ok((backend, status)) => {
                log::info!(
                    "engine: loaded {} and logged in ({})",
                    path.display(),
                    if status == LoginStatus::Running {
                        "Voicemeeter running"
                    } else {
                        "Voicemeeter not running"
                    }
                );
                self.real = Some(Box::new(backend));
                self.update_info();
                Ok(())
            }
            Err(OpenError::Load(e)) => {
                log::error!("engine: couldn't load {}: {e}", path.display());
                Err(ConnectionState::DllError {
                    message: e.to_string(),
                })
            }
            Err(OpenError::Login(e)) => {
                log::error!("engine: Login failed: {e}");
                let code = match &e {
                    VmrError::Code { code, .. } => *code,
                    _ => -1,
                };
                let state = ConnectionState::LoginFailed {
                    code,
                    message: e.to_string(),
                };
                self.real_final = Some(state.clone());
                Err(state)
            }
        }
    }

    fn connected_tick(&mut self) {
        let Some(b) = backend!(self) else {
            self.disconnected();
            return;
        };
        let dirty = match b.is_dirty() {
            Ok(d) => d,
            Err(VmrError::NoServer) => {
                self.disconnected();
                return;
            }
            Err(e) => {
                self.log_error(&format!("IsParametersDirty failed: {e}"));
                false
            }
        };
        if dirty || self.force_read {
            self.force_read = false;
            if self.read_all().is_err() {
                self.disconnected();
                return;
            }
        }
        self.push_levels();
    }

    /// Reads core + subscribed groups and emits what changed. `Err` = Voicemeeter went away.
    fn read_all(&mut self) -> Result<(), VmrError> {
        let Some(b) = backend!(self) else {
            return Err(VmrError::NoServer);
        };
        let read = groups::core::read(b)?;
        if self.strips_buses.as_ref() != Some(&read) {
            self.rev += 1;
            let state = MixerState {
                connection: self.connection.clone(),
                strips: read.0.clone(),
                buses: read.1.clone(),
                rev: self.rev,
            };
            self.strips_buses = Some(read);
            if let Ok(mut s) = self.snapshot.write() {
                *s = state.clone();
            }
            self.sink.state(&state);
        }
        let ids: Vec<String> = self.subs.keys().cloned().collect();
        for id in ids {
            if self.read_group(&id) == Err(VmrError::NoServer) {
                return Err(VmrError::NoServer);
            }
        }
        Ok(())
    }

    /// Reads one subscribed group and emits it if it changed.
    fn read_group(&mut self, id: &str) -> Result<(), VmrError> {
        let b = backend!(self).ok_or(VmrError::NoServer)?;
        let Some(sub) = self.subs.get_mut(id) else {
            return Ok(());
        };
        let (ev, result) = match sub.group.read(b) {
            Ok(data) => (
                GroupEvent {
                    id: id.to_owned(),
                    data: Some(data),
                    error: None,
                },
                Ok(()),
            ),
            Err(VmrError::NoServer) => return Err(VmrError::NoServer),
            Err(e) => (
                GroupEvent {
                    id: id.to_owned(),
                    data: None,
                    error: Some(e.to_string()),
                },
                Ok(()),
            ),
        };
        if sub.last.as_ref() != Some(&ev) {
            self.sink.group(&ev);
            sub.last = Some(ev);
        }
        result
    }

    fn push_levels(&mut self) {
        if self.levels.is_none() || self.background {
            return;
        }
        let input_kind = match self.meter_mode {
            0 => LevelKind::PreFader,
            2 => LevelKind::PostMute,
            _ => LevelKind::PostFader,
        };
        let Some(b) = backend!(self) else {
            return;
        };
        let level = |kind, ch| match b.get_level(kind, ch) {
            Ok(v) if v.is_finite() => v.max(0.0),
            _ => 0.0,
        };
        let frame = Levels {
            inputs: (0..layout::IN_LEVEL_CH)
                .map(|c| level(input_kind, c))
                .collect(),
            outputs: (0..layout::OUT_LEVEL_CH)
                .map(|c| level(LevelKind::Output, c))
                .collect(),
        };
        self.send_levels(&frame);
    }

    fn send_levels(&mut self, frame: &Levels) {
        if let Some(sink) = self.levels.as_mut()
            && !sink(frame)
        {
            log::info!("engine: levels receiver went away");
            self.levels = None;
        }
    }

    fn disconnected(&mut self) {
        self.next_poll = Instant::now() + POLL_DISCONNECTED;
        self.set_connection(ConnectionState::NotRunning);
    }

    fn set_connection(&mut self, next: ConnectionState) {
        if next == self.connection {
            return;
        }
        log::info!("engine: connection {:?} -> {:?}", self.connection, next);
        let was_connected = self.connection.is_connected();
        self.connection = next.clone();
        if let Ok(mut s) = self.snapshot.write() {
            s.connection = next.clone();
        }
        self.sink.connection(&next);
        if was_connected && !next.is_connected() {
            self.send_levels(&Levels::silent());
        }
    }

    fn note_tick_time(&mut self, took: Duration) {
        if took <= SLOW_TICK {
            return;
        }
        self.slow_count += 1;
        if self.slow_last_warn.elapsed() >= Duration::from_secs(10) {
            log::warn!(
                "engine: {} tick(s) over {} ms in the last 10 s (latest {:.2} ms)",
                self.slow_count,
                SLOW_TICK.as_millis(),
                took.as_secs_f64() * 1000.0
            );
            self.slow_count = 0;
            self.slow_last_warn = Instant::now();
        }
    }

    fn log_error(&mut self, msg: &str) {
        if self.err_last_log.elapsed() >= Duration::from_secs(5) {
            log::warn!("engine: {msg}");
            self.err_last_log = Instant::now();
        }
    }
}

fn respond<T>(reply: Reply<T>, result: Result<T, String>) {
    if let Some(tx) = reply {
        let _ = tx.send(result);
    }
}

#[cfg(test)]
mod tests;
