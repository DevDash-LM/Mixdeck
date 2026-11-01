//! Worker tests against the fake backend, driven tick by tick.

use std::sync::mpsc;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use super::state::*;
use super::*;

#[derive(Default)]
struct Log {
    states: Vec<MixerState>,
    groups: Vec<GroupEvent>,
    connections: Vec<ConnectionState>,
}

#[derive(Clone, Default)]
struct Recorder(Arc<Mutex<Log>>);

impl Sink for Recorder {
    fn state(&self, s: &MixerState) {
        self.0.lock().unwrap().states.push(s.clone());
    }
    fn group(&self, ev: &GroupEvent) {
        self.0.lock().unwrap().groups.push(ev.clone());
    }
    fn connection(&self, c: &ConnectionState) {
        self.0.lock().unwrap().connections.push(c.clone());
    }
    fn meter_mode(&self) -> u8 {
        2
    }
}

fn worker(start: FakeStart) -> (Worker<Recorder>, Recorder, mpsc::Sender<Command>) {
    let rec = Recorder::default();
    let (tx, rx) = mpsc::channel();
    let w = Worker::new(
        rec.clone(),
        rx,
        Options { fake: Some(start) },
        Arc::new(RwLock::new(MixerState::default())),
        Arc::new(RwLock::new(EngineInfo {
            backend: BackendKind::Fake,
            forced_by_env: true,
            dll_path: None,
        })),
    );
    (w, rec, tx)
}

/// Runs `n` ticks, each pretending the poll interval has passed.
fn ticks(w: &mut Worker<Recorder>, n: usize) {
    for _ in 0..n {
        w.next_poll = Instant::now();
        w.tick(Instant::now());
    }
}

fn set(w: &mut Worker<Recorder>, name: String, v: f32) -> Result<(), String> {
    let (tx, mut rx) = oneshot::channel();
    w.handle(Command::SetParam {
        name,
        value: ParamValue::Num(v),
        reply: Some(tx),
    });
    rx.try_recv().expect("reply sent")
}

#[test]
fn connects_and_emits_state() {
    let (mut w, rec, _tx) = worker(FakeStart::Running);
    ticks(&mut w, 2);
    let log = rec.0.lock().unwrap();
    assert!(matches!(
        log.connections.last(),
        Some(ConnectionState::Connected { .. })
    ));
    let state = log.states.last().expect("state emitted");
    assert_eq!(state.rev, 1);
    assert_eq!(state.strips[0].label, "Mic");
    assert!(state.connection.is_connected());
    assert_eq!(w.snapshot.read().unwrap().rev, 1);
}

#[test]
fn set_param_round_trips_and_only_changes_emit() {
    let (mut w, rec, _tx) = worker(FakeStart::Running);
    ticks(&mut w, 3);
    assert_eq!(rec.0.lock().unwrap().states.len(), 1, "no change, no emit");
    set(&mut w, params::strip(0).gain(), -10.0).unwrap();
    ticks(&mut w, 1);
    let log = rec.0.lock().unwrap();
    assert_eq!(log.states.len(), 2);
    assert_eq!(log.states[1].strips[0].gain, -10.0);
    assert_eq!(log.states[1].rev, 2);
}

#[test]
fn set_param_errors_are_readable() {
    let (mut w, _rec, _tx) = worker(FakeStart::Running);
    ticks(&mut w, 1);
    let err = set(&mut w, "Strip[0].Bogus".into(), 1.0).unwrap_err();
    assert!(err.contains("Strip[0].Bogus"), "{err}");

    let (mut w, _rec, _tx) = worker(FakeStart::Offline);
    ticks(&mut w, 1);
    assert_eq!(
        set(&mut w, params::strip(0).gain(), 0.0).unwrap_err(),
        "Voicemeeter isn't connected."
    );
}

#[test]
fn connection_flips_both_ways() {
    let (mut w, rec, _tx) = worker(FakeStart::Offline);
    ticks(&mut w, 1);
    assert_eq!(w.connection, ConnectionState::NotRunning);

    w.handle(Command::Simulate {
        event: FakeEvent::Start,
        reply: None,
    });
    ticks(&mut w, 1);
    assert!(w.connection.is_connected());

    w.handle(Command::Simulate {
        event: FakeEvent::Quit,
        reply: None,
    });
    ticks(&mut w, 1);
    assert_eq!(w.connection, ConnectionState::NotRunning);

    w.handle(Command::Simulate {
        event: FakeEvent::StartBanana,
        reply: None,
    });
    ticks(&mut w, 1);
    assert_eq!(
        w.connection,
        ConnectionState::WrongEdition {
            vm_type: VmEdition::Banana
        }
    );

    let log = rec.0.lock().unwrap();
    assert_eq!(log.connections.len(), 4);
}

#[test]
fn launch_starts_fake_after_delay() {
    let (mut w, _rec, _tx) = worker(FakeStart::Offline);
    ticks(&mut w, 1);
    w.handle(Command::Launch { reply: None });
    ticks(&mut w, 1);
    assert_eq!(
        w.connection,
        ConnectionState::NotRunning,
        "launch takes a moment"
    );
    std::thread::sleep(Duration::from_millis(1600));
    ticks(&mut w, 1);
    assert!(w.connection.is_connected());
}

#[test]
fn external_edits_show_up() {
    let (mut w, rec, _tx) = worker(FakeStart::Running);
    ticks(&mut w, 1);
    w.handle(Command::Simulate {
        event: FakeEvent::ExternalEdit,
        reply: None,
    });
    ticks(&mut w, 1);
    let log = rec.0.lock().unwrap();
    assert_eq!(log.states.len(), 2);
    assert_ne!(log.states[0].strips[1].gain, log.states[1].strips[1].gain);
}

#[test]
fn levels_flow_and_zero_on_disconnect() {
    let (mut w, _rec, _tx) = worker(FakeStart::Running);
    let frames: Arc<Mutex<Vec<Levels>>> = Arc::default();
    let f2 = frames.clone();
    w.handle(Command::StartLevels(Box::new(move |l| {
        f2.lock().unwrap().push(l.clone());
        true
    })));
    ticks(&mut w, 5);
    {
        let f = frames.lock().unwrap();
        assert!(f.len() >= 4);
        assert_eq!(f[0].inputs.len(), 34);
        assert_eq!(f[0].outputs.len(), 64);
        assert!(f.iter().any(|l| l.outputs.iter().any(|v| *v > 0.0)));
    }
    w.handle(Command::Simulate {
        event: FakeEvent::Quit,
        reply: None,
    });
    ticks(&mut w, 1);
    let f = frames.lock().unwrap();
    assert_eq!(f.last(), Some(&Levels::silent()));
}

#[test]
fn background_pauses_levels_and_slows_the_loop() {
    let (mut w, _rec, _tx) = worker(FakeStart::Running);
    let frames: Arc<Mutex<usize>> = Arc::default();
    let f2 = frames.clone();
    w.handle(Command::StartLevels(Box::new(move |_| {
        *f2.lock().unwrap() += 1;
        true
    })));
    ticks(&mut w, 2);
    assert_eq!(w.tick_period(), TICK);
    let before = *frames.lock().unwrap();
    assert!(before >= 1);

    w.handle(Command::SetBackground(true));
    ticks(&mut w, 5);
    assert_eq!(
        *frames.lock().unwrap(),
        before,
        "no levels in the background"
    );
    assert_eq!(w.tick_period(), TICK_IDLE);
    // The snapshot (used by hotkeys while hidden) still follows external edits.
    w.handle(Command::Simulate {
        event: FakeEvent::ExternalEdit,
        reply: None,
    });
    let rev = w.snapshot.read().unwrap().rev;
    ticks(&mut w, 1);
    assert_eq!(w.snapshot.read().unwrap().rev, rev + 1);

    w.handle(Command::SetBackground(false));
    ticks(&mut w, 1);
    assert_eq!(*frames.lock().unwrap(), before + 1);
    assert_eq!(w.tick_period(), TICK);
}

#[test]
fn disconnected_loop_ticks_slowly() {
    let (mut w, _rec, _tx) = worker(FakeStart::Offline);
    ticks(&mut w, 1);
    assert_eq!(w.tick_period(), TICK_IDLE);
}

/// Soak stand-in: many Voicemeeter restarts with a detail group subscribed. Every reconnect
/// must re-emit the state and the group, and nothing may accumulate.
#[test]
fn many_restarts_recover_every_time() {
    let (mut w, rec, _tx) = worker(FakeStart::Running);
    ticks(&mut w, 1);
    let (tx, mut rx) = oneshot::channel();
    w.handle(Command::Subscribe {
        id: "strip_fx:0".into(),
        reply: Some(tx),
    });
    rx.try_recv().expect("reply").expect("subscribed");
    ticks(&mut w, 1);
    for i in 0..200 {
        w.handle(Command::Simulate {
            event: FakeEvent::Quit,
            reply: None,
        });
        ticks(&mut w, 2);
        assert_eq!(w.connection, ConnectionState::NotRunning, "cycle {i}");
        w.handle(Command::Simulate {
            event: FakeEvent::Start,
            reply: None,
        });
        ticks(&mut w, 2);
        assert!(w.connection.is_connected(), "cycle {i}");
    }
    assert_eq!(w.subs.len(), 1);
    let log = rec.0.lock().unwrap();
    assert_eq!(log.connections.len(), 1 + 400);
    assert!(w.snapshot.read().unwrap().connection.is_connected());
}

#[test]
fn levels_sink_dropped_when_gone() {
    let (mut w, _rec, _tx) = worker(FakeStart::Running);
    w.handle(Command::StartLevels(Box::new(|_| false)));
    ticks(&mut w, 2);
    assert!(w.levels.is_none());
}

#[test]
fn unknown_group_is_an_error_and_core_is_noop() {
    let (mut w, _rec, _tx) = worker(FakeStart::Running);
    assert!(w.subscribe("nope:1".into()).is_err());
    assert!(w.subscribe(groups::CORE.into()).is_ok());
    assert!(w.subs.is_empty());
}

#[test]
fn panic_recovery_keeps_backend_and_reemits() {
    let (mut w, rec, _tx) = worker(FakeStart::Running);
    ticks(&mut w, 1);
    w.recover();
    assert!(w.fake.is_some());
    set(&mut w, params::strip(3).gain(), -1.0).unwrap();
    ticks(&mut w, 1);
    let log = rec.0.lock().unwrap();
    assert_eq!(log.states.last().map(|s| s.rev), Some(2));
}

#[test]
fn engine_thread_runs_and_shuts_down() {
    let rec = Recorder::default();
    let engine = Engine::spawn(
        rec.clone(),
        Options {
            fake: Some(FakeStart::Running),
        },
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    while engine.state().rev == 0 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(engine.state().connection.is_connected());
    engine.shutdown();
    assert!(engine.send(Command::Retry).is_err(), "worker is gone");
}

fn request(
    w: &mut Worker<Recorder>,
    make: impl FnOnce(Reply<()>) -> Command,
) -> Result<(), String> {
    let (tx, mut rx) = oneshot::channel();
    w.handle(make(Some(tx)));
    rx.try_recv().expect("reply sent")
}

#[test]
fn devices_group_refreshes_on_request_after_hot_plug() {
    let (mut w, rec, _tx) = worker(FakeStart::Running);
    ticks(&mut w, 2);
    // Not subscribed yet → readable error.
    assert!(
        request(&mut w, |reply| Command::RefreshGroup {
            id: "devices".into(),
            reply
        })
        .is_err()
    );
    request(&mut w, |reply| Command::Subscribe {
        id: "devices".into(),
        reply,
    })
    .unwrap();
    let count = |rec: &Recorder| {
        rec.0
            .lock()
            .unwrap()
            .groups
            .iter()
            .filter(|g| g.id == "devices")
            .count()
    };
    assert_eq!(count(&rec), 1);

    // A hot-plug doesn't set dirty, so ticks don't pick it up …
    if let Some(f) = backend!(w).and_then(|b| b.as_fake_mut()) {
        f.simulate(FakeEvent::PlugDevice);
    }
    ticks(&mut w, 3);
    assert_eq!(count(&rec), 1);
    // … but a refresh does, and an unchanged refresh emits nothing.
    request(&mut w, |reply| Command::RefreshGroup {
        id: "devices".into(),
        reply,
    })
    .unwrap();
    assert_eq!(count(&rec), 2);
    request(&mut w, |reply| Command::RefreshGroup {
        id: "devices".into(),
        reply,
    })
    .unwrap();
    assert_eq!(count(&rec), 2);
    let log = rec.0.lock().unwrap();
    let data = log
        .groups
        .last()
        .and_then(|g| g.data.clone())
        .expect("data");
    assert!(data.to_string().contains("USB Audio Headset"));
}
