//! `FakeSessions`: simulated app sessions under `MIXDECK_FAKE`.
//! Chrome + Spotify on V IN 1 (strip 5), Discord on AUX (strip 6), nothing on VAIO3 (strip 7),
//! OBS recording from B1. Peaks move; `simulate` adds/removes apps.

use std::time::Instant;

use super::SessionsError;
use super::icons::{data_url, encode_png};
use super::mapping::{Mapping, TARGETS};
use super::types::{AppSession, EndpointApps, SessionTarget, SessionsFakeEvent, session_key};
use super::worker::{ScanOptions, SessionsBackend};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Signal {
    /// Steady music.
    Music,
    /// Plays 6 s, pauses 3 s (the session goes inactive while paused).
    Video,
    /// Speech bursts.
    Voice,
    /// A recorder reading a bus.
    Recorder,
    /// System sounds: silent and inactive.
    System,
}

struct Seed {
    target: SessionTarget,
    pid: u32,
    name: &'static str,
    exe: Option<&'static str>,
    colour: [u8; 3],
    signal: Signal,
}

const SEEDS: [Seed; 5] = [
    Seed {
        target: SessionTarget::strip(5),
        pid: 4120,
        name: "Google Chrome",
        exe: Some(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
        colour: [0x1A, 0x73, 0xE8],
        signal: Signal::Video,
    },
    Seed {
        target: SessionTarget::strip(5),
        pid: 8836,
        name: "Spotify",
        exe: Some(r"C:\Users\Demo\AppData\Roaming\Spotify\Spotify.exe"),
        colour: [0x1E, 0xD7, 0x60],
        signal: Signal::Music,
    },
    Seed {
        target: SessionTarget::strip(6),
        pid: 11204,
        name: "Discord",
        exe: Some(r"C:\Users\Demo\AppData\Local\Discord\app-1.0.9200\Discord.exe"),
        colour: [0x58, 0x65, 0xF2],
        signal: Signal::Voice,
    },
    Seed {
        target: SessionTarget::bus(5),
        pid: 6620,
        name: "OBS Studio",
        exe: Some(r"C:\Program Files\obs-studio\bin\64bit\obs64.exe"),
        colour: [0x30, 0x2E, 0x31],
        signal: Signal::Recorder,
    },
    Seed {
        target: SessionTarget::strip(5),
        pid: 0,
        name: "System sounds",
        exe: None,
        colour: [0x80, 0x80, 0x80],
        signal: Signal::System,
    },
];

/// Apps `AddApp` starts, in order.
const POOL: [Seed; 3] = [
    Seed {
        target: SessionTarget::strip(7),
        pid: 15012,
        name: "VLC media player",
        exe: Some(r"C:\Program Files\VideoLAN\VLC\vlc.exe"),
        colour: [0xFF, 0x88, 0x00],
        signal: Signal::Music,
    },
    Seed {
        target: SessionTarget::strip(6),
        pid: 9480,
        name: "Firefox",
        exe: Some(r"C:\Program Files\Mozilla Firefox\firefox.exe"),
        colour: [0xFF, 0x71, 0x39],
        signal: Signal::Video,
    },
    Seed {
        target: SessionTarget::bus(6),
        pid: 13300,
        name: "Zoom Workplace",
        exe: Some(r"C:\Users\Demo\AppData\Roaming\Zoom\bin\Zoom.exe"),
        colour: [0x0B, 0x5C, 0xFF],
        signal: Signal::Voice,
    },
];

fn endpoint_name(t: SessionTarget) -> &'static str {
    use super::types::SessionTargetKind::*;
    match (t.kind, t.index) {
        (Strip, 5) => "Voicemeeter Input",
        (Strip, 6) => "Voicemeeter AUX Input",
        (Strip, 7) => "Voicemeeter VAIO3 Input",
        (Bus, 5) => "Voicemeeter Out B1",
        (Bus, 6) => "Voicemeeter Out B2",
        _ => "Voicemeeter Out B3",
    }
}

/// A 32×32 rounded square in the app's colour.
fn fake_icon(rgb: [u8; 3]) -> Option<String> {
    const N: u32 = 32;
    const R: f32 = 7.0;
    let mut px = Vec::with_capacity((N * N * 4) as usize);
    for y in 0..N {
        for x in 0..N {
            let (fx, fy) = (x as f32 + 0.5, y as f32 + 0.5);
            let cx = fx.clamp(R + 2.0, N as f32 - R - 2.0);
            let cy = fy.clamp(R + 2.0, N as f32 - R - 2.0);
            let d = ((fx - cx).powi(2) + (fy - cy).powi(2)).sqrt();
            let a = (R + 0.5 - d).clamp(0.0, 1.0);
            px.extend_from_slice(&[rgb[0], rgb[1], rgb[2], (a * 255.0) as u8]);
        }
    }
    encode_png(N, N, &px).map(|p| data_url(&p))
}

struct FakeApp {
    target: SessionTarget,
    signal: Signal,
    phase: f32,
    app: AppSession,
}

impl FakeApp {
    fn from_seed(s: &Seed) -> Self {
        let system = s.signal == Signal::System;
        Self {
            target: s.target,
            signal: s.signal,
            phase: (s.pid % 97) as f32 * 0.37,
            app: AppSession {
                key: session_key(&format!(
                    "fake|{:?}{}|{}|{}",
                    s.target.kind, s.target.index, s.pid, s.name
                )),
                pid: s.pid,
                name: s.name.into(),
                exe: s.exe.map(str::to_owned),
                icon: if system { None } else { fake_icon(s.colour) },
                active: !system,
                volume: 1.0,
                muted: false,
                system,
            },
        }
    }

    fn playing(&self, t: f32) -> bool {
        match self.signal {
            Signal::Video => (t + self.phase) % 9.0 < 6.0,
            Signal::System => false,
            _ => true,
        }
    }

    fn peak(&self, t: f32) -> f32 {
        if self.app.muted || !self.playing(t) {
            return 0.0;
        }
        let p = self.phase;
        let raw = match self.signal {
            Signal::Music => 0.35 + 0.3 * (t * 7.3 + p).sin().abs() * (0.6 + 0.4 * (t * 0.9).sin()),
            Signal::Video => 0.3 + 0.3 * (t * 11.0 + p).sin().abs(),
            Signal::Voice => {
                if (t * 0.7 + p).sin() > 0.2 {
                    0.2 + 0.5 * ((t * 17.0 + p).sin() * (t * 3.1).sin()).abs()
                } else {
                    0.0
                }
            }
            Signal::Recorder => 0.15 + 0.05 * (t * 2.0).sin(),
            Signal::System => 0.0,
        };
        (raw * self.app.volume).clamp(0.0, 1.0)
    }
}

pub struct FakeSessions {
    apps: Vec<FakeApp>,
    /// Keys `AddApp` started, newest last.
    added: Vec<String>,
    started: Instant,
}

impl Default for FakeSessions {
    fn default() -> Self {
        Self::new()
    }
}

impl FakeSessions {
    pub fn new() -> Self {
        Self {
            apps: SEEDS.iter().map(FakeApp::from_seed).collect(),
            added: Vec::new(),
            started: Instant::now(),
        }
    }

    fn t(&self) -> f32 {
        self.started.elapsed().as_secs_f32()
    }

    fn app_mut(&mut self, key: &str) -> Result<&mut AppSession, SessionsError> {
        self.apps
            .iter_mut()
            .map(|a| &mut a.app)
            .find(|a| a.key == key)
            .ok_or(SessionsError::UnknownApp)
    }
}

impl SessionsBackend for FakeSessions {
    fn is_fake(&self) -> bool {
        true
    }

    /// Endpoint rules don't apply: every simulated endpoint is always found.
    fn scan(
        &mut self,
        _mapping: &Mapping,
        opts: &ScanOptions,
    ) -> Result<Vec<EndpointApps>, SessionsError> {
        let t = self.t();
        for a in &mut self.apps {
            if a.signal == Signal::Video {
                let playing = (t + a.phase) % 9.0 < 6.0;
                a.app.active = playing;
            }
        }
        Ok(TARGETS
            .iter()
            .map(|&target| {
                let mut apps: Vec<AppSession> = self
                    .apps
                    .iter()
                    .filter(|a| a.target == target && (opts.show_system || !a.app.system))
                    .map(|a| a.app.clone())
                    .collect();
                apps.sort_by_key(|a| a.name.to_lowercase());
                EndpointApps {
                    target,
                    endpoint: Some(endpoint_name(target).into()),
                    found: true,
                    apps,
                }
            })
            .collect())
    }

    fn peaks(&mut self, out: &mut Vec<(String, f32)>) {
        let t = self.t();
        out.clear();
        out.extend(
            self.apps
                .iter()
                .filter(|a| !a.app.system)
                .map(|a| (a.app.key.clone(), a.peak(t))),
        );
    }

    fn set_volume(&mut self, key: &str, volume: f32) -> Result<(), SessionsError> {
        self.app_mut(key)?.volume = volume.clamp(0.0, 1.0);
        Ok(())
    }

    fn set_mute(&mut self, key: &str, muted: bool) -> Result<(), SessionsError> {
        self.app_mut(key)?.muted = muted;
        Ok(())
    }

    fn simulate(&mut self, event: SessionsFakeEvent) -> Result<(), SessionsError> {
        match event {
            SessionsFakeEvent::AddApp => {
                let next = POOL
                    .iter()
                    .map(FakeApp::from_seed)
                    .find(|n| !self.apps.iter().any(|a| a.app.key == n.app.key))
                    .ok_or_else(|| {
                        SessionsError::Simulation("All demo apps are already running.".into())
                    })?;
                self.added.push(next.app.key.clone());
                self.apps.push(next);
                Ok(())
            }
            SessionsFakeEvent::RemoveApp => {
                let key = match self.added.pop() {
                    Some(k) => k,
                    None => self
                        .apps
                        .iter()
                        .rev()
                        .find(|a| !a.app.system)
                        .map(|a| a.app.key.clone())
                        .ok_or_else(|| {
                            SessionsError::Simulation("No demo apps left to stop.".into())
                        })?,
                };
                self.apps.retain(|a| a.app.key != key);
                Ok(())
            }
        }
    }
}
