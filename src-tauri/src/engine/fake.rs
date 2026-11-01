//! `FakeBackend`: a simulated Voicemeeter Potato for developing and testing the UI without the
//! real engine (`MIXDECK_FAKE=1`, or demo mode).
//!
//! It knows every parameter the cheatsheet lists for Potato (names built with `vmr::params`),
//! clamps writes to the documented ranges, rejects unknown names like the real DLL, applies
//! scripts atomically, enumerates plausible devices, and synthesises meters that follow gain,
//! mute and routing. Demo hooks (`simulate`) fake external edits and Voicemeeter quitting or
//! starting, so every connection screen can be exercised.

use std::cell::Cell;
use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::vmr::layout::{self, BUSES, STRIPS};
use crate::vmr::params::{self, BusMode, DeviceParam, EqField};
use crate::vmr::{DeviceDesc, DeviceKind, LevelKind, RunKind, VmType, VmrError};

use super::backend::VmBackend;
use super::state::{BackendKind, FakeEvent};

/// How long a simulated "Launch Voicemeeter" takes.
const LAUNCH_DELAY: Duration = Duration::from_millis(1500);
/// How long a simulated `Command.Restart` silences the meters.
const RESTART_SILENCE: Duration = Duration::from_millis(800);

/// Initial fake engine state, from the `MIXDECK_FAKE` value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FakeStart {
    /// `1`, `potato`, anything else: Potato is running.
    Running,
    /// `offline`: not running; "Launch Voicemeeter" starts it after 1.5 s.
    Offline,
    /// `banana`: the wrong edition is running.
    Banana,
    /// `missing`: behaves as if Voicemeeter isn't installed (the DLL can't be found), so the
    /// "not installed" screen can be tested. `simulate(start)` recovers.
    Missing,
}

impl FakeStart {
    pub fn from_env_value(v: &str) -> Self {
        match v.trim().to_ascii_lowercase().as_str() {
            "offline" | "notrunning" | "not-running" => FakeStart::Offline,
            "banana" | "wrong" | "wrong-edition" => FakeStart::Banana,
            "missing" | "not-installed" | "notinstalled" => FakeStart::Missing,
            _ => FakeStart::Running,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
enum Val {
    Num(f32),
    Str(String),
}

pub struct FakeBackend {
    /// Simulates a missing install (`FakeStart::Missing`).
    missing: Cell<bool>,
    params: HashMap<String, Val>,
    running: Cell<Option<VmType>>,
    launch_at: Cell<Option<Instant>>,
    dirty: bool,
    epoch: Instant,
    restart_until: Option<Instant>,
    inputs: Vec<DeviceDesc>,
    outputs: Vec<DeviceDesc>,
    edit_step: u32,
}

impl FakeBackend {
    pub fn new(start: FakeStart) -> Self {
        let running = match start {
            FakeStart::Running => Some(VmType::Potato),
            FakeStart::Offline => None,
            FakeStart::Banana => Some(VmType::Banana),
            FakeStart::Missing => None,
        };
        Self {
            missing: Cell::new(start == FakeStart::Missing),
            params: seed(),
            running: Cell::new(running),
            launch_at: Cell::new(None),
            dirty: true,
            epoch: Instant::now(),
            restart_until: None,
            inputs: fake_inputs(),
            outputs: fake_outputs(),
            edit_step: 0,
        }
    }

    /// Demo-mode hook: simulate something happening on the Voicemeeter side.
    pub fn simulate(&mut self, ev: FakeEvent) {
        match ev {
            FakeEvent::ExternalEdit => self.external_edit(),
            FakeEvent::Quit => {
                self.running.set(None);
                self.launch_at.set(None);
            }
            FakeEvent::Start => {
                self.missing.set(false);
                self.running.set(Some(VmType::Potato));
                self.dirty = true;
            }
            FakeEvent::StartBanana => {
                self.missing.set(false);
                self.running.set(Some(VmType::Banana));
                self.dirty = true;
            }
            FakeEvent::PlugDevice => self.toggle_usb_device(),
        }
    }

    /// Adds or removes a hot-plugged USB headset in both device lists.
    fn toggle_usb_device(&mut self) {
        let plugged = self.inputs.iter().any(|d| d.name.contains(USB_DEVICE));
        if plugged {
            self.inputs.retain(|d| !d.name.contains(USB_DEVICE));
            self.outputs.retain(|d| !d.name.contains(USB_DEVICE));
        } else {
            use DeviceKind::*;
            let mic = format!("Microphone ({USB_DEVICE})");
            let out = format!("Headphones ({USB_DEVICE})");
            self.inputs.extend([dev(Wdm, &mic, 21), dev(Mme, &mic, 22)]);
            self.outputs
                .extend([dev(Wdm, &out, 23), dev(Mme, &out, 24)]);
        }
    }

    /// Applies a finished simulated launch.
    fn running_now(&self) -> Option<VmType> {
        if let Some(at) = self.launch_at.get()
            && Instant::now() >= at
        {
            self.launch_at.set(None);
            self.running.set(Some(VmType::Potato));
        }
        self.running.get()
    }

    fn require_server(&self) -> Result<(), VmrError> {
        match self.running_now() {
            Some(_) => Ok(()),
            None => Err(VmrError::NoServer),
        }
    }

    /// One "someone used Voicemeeter's own UI" change, cycling through a few kinds.
    fn external_edit(&mut self) {
        let step = self.edit_step;
        self.edit_step = self.edit_step.wrapping_add(1);
        let s1 = params::strip(1);
        let b1 = params::bus(1);
        match step % 5 {
            0 => {
                let g = self.num(&s1.gain());
                let next = if g > -10.0 { -18.0 } else { -2.5 };
                self.put(&s1.gain(), Val::Num(next));
            }
            1 => {
                let n = &params::strip(2).mute();
                let m = self.num(n);
                self.put(n, Val::Num(if m >= 0.5 { 0.0 } else { 1.0 }));
            }
            2 => {
                let cur = BusMode::ALL
                    .iter()
                    .position(|m| self.num(&b1.mode(*m)) >= 0.5)
                    .unwrap_or(0);
                let next = BusMode::ALL[(cur + 1) % BusMode::ALL.len()];
                self.select_mode(1, next);
            }
            3 => {
                let n = &params::strip(6).label();
                let next = if self.string(n).is_empty() {
                    "Music"
                } else {
                    ""
                };
                self.put(n, Val::Str(next.into()));
            }
            _ => {
                let n = &params::strip(7).route(5);
                let r = self.num(n);
                self.put(n, Val::Num(if r >= 0.5 { 0.0 } else { 1.0 }));
            }
        }
        self.dirty = true;
    }

    fn num(&self, name: &str) -> f32 {
        match self.params.get(name) {
            Some(Val::Num(v)) => *v,
            _ => 0.0,
        }
    }

    fn string(&self, name: &str) -> String {
        match self.params.get(name) {
            Some(Val::Str(s)) => s.clone(),
            _ => String::new(),
        }
    }

    fn put(&mut self, name: &str, v: Val) {
        self.params.insert(name.to_owned(), v);
    }

    fn select_mode(&mut self, bus: usize, mode: BusMode) {
        let b = params::bus(bus);
        for m in BusMode::ALL {
            self.put(&b.mode(m), Val::Num(if m == mode { 1.0 } else { 0.0 }));
        }
    }

    /// Checks one write without applying it. Returns the change to make.
    fn plan_write(&self, name: &str, value: Val) -> Result<Write, VmrError> {
        if let Some(cmd) = command_kind(name) {
            return Ok(Write::Command(cmd));
        }
        if is_phantom(name) {
            return Ok(Write::Ignore);
        }
        if let Some((target, sr)) = device_target(name) {
            return match value {
                Val::Str(s) => Ok(Write::Device {
                    name_param: target,
                    sr_param: sr,
                    device: s,
                }),
                Val::Num(_) => Err(VmrError::UnknownParam(name.to_owned())),
            };
        }
        match (self.params.get(name), value) {
            (None, _) => Err(VmrError::UnknownParam(name.to_owned())),
            (Some(Val::Num(_)), Val::Num(v)) => {
                if !v.is_finite() {
                    return Err(VmrError::InvalidInput(format!(
                        "{name}: value is not finite"
                    )));
                }
                Ok(Write::Set(name.to_owned(), Val::Num(clamp(name, v))))
            }
            (Some(Val::Num(_)), Val::Str(s)) => match s.trim().parse::<f32>() {
                Ok(v) if v.is_finite() => Ok(Write::Set(name.to_owned(), Val::Num(clamp(name, v)))),
                _ => Err(VmrError::UnknownParam(name.to_owned())),
            },
            (Some(Val::Str(_)), Val::Str(s)) => {
                if is_read_only(name) {
                    Err(VmrError::UnknownParam(name.to_owned()))
                } else {
                    Ok(Write::Set(name.to_owned(), Val::Str(s)))
                }
            }
            (Some(Val::Str(_)), Val::Num(_)) => Err(VmrError::UnknownParam(name.to_owned())),
        }
    }

    fn apply(&mut self, w: Write) {
        match w {
            Write::Set(name, Val::Num(v)) => {
                if let Some(bus) = mode_bus(&name) {
                    // Exactly one mode reads 1: writing 1 selects it, writing 0 is ignored.
                    if v >= 0.5
                        && let Some(mode) = BusMode::ALL
                            .into_iter()
                            .find(|m| name == params::bus(bus).mode(*m))
                    {
                        self.select_mode(bus, mode);
                    }
                } else {
                    self.put(&name, Val::Num(v));
                }
            }
            Write::Set(name, v) => self.put(&name, v),
            Write::Device {
                name_param,
                sr_param,
                device,
            } => {
                let sr = if device.is_empty() { 0.0 } else { 48000.0 };
                self.put(&name_param, Val::Str(device));
                self.put(&sr_param, Val::Num(sr));
            }
            Write::Command(CommandKind::Restart) => {
                self.restart_until = Some(Instant::now() + RESTART_SILENCE);
            }
            Write::Command(CommandKind::Other) => {}
            Write::Ignore => return,
        }
        self.dirty = true;
    }

    /// Simulated source level of strip `i`, channel `c` (pre-fader, linear).
    fn source_level(&self, i: usize, c: u32, t: f32) -> f32 {
        let stereo_only = |amp: f32| if c < 2 { amp } else { 0.0 };
        let wobble = 0.85 + 0.15 * noise(i as u32 * 64 + c, (t * 30.0) as u32);
        let lr = if c.is_multiple_of(2) { 1.0 } else { 0.92 };
        let base = match i {
            // Mic: speech-like bursts.
            0 => {
                let syll = (t * 5.3).sin().max(0.0) * ((t * 0.7).sin() * 0.5 + 0.5);
                let talking = if (t * 0.35).sin() > -0.3 { 1.0 } else { 0.03 };
                stereo_only(0.45 * syll * talking + 0.004)
            }
            // Line in: steady music with a beat.
            1 => stereo_only(0.25 + 0.2 * ((t * 2.0 * std::f32::consts::PI * 2.0).sin().max(0.0))),
            // Interface: quiet.
            2 => stereo_only(0.06 + 0.04 * (t * 1.1).sin().abs()),
            // Desktop audio: loud music.
            5 => stereo_only(0.5 + 0.3 * ((t * 7.5).sin() * (t * 0.9).cos()).abs()),
            // AUX: soft background on all 8 channels.
            6 => 0.04 + 0.03 * (t * 0.5 + c as f32).sin().abs(),
            _ => 0.0,
        };
        (base * wobble * lr).min(1.2)
    }

    fn strip_post(&self, i: usize, c: u32, t: f32, kind: LevelKind) -> f32 {
        let s = params::strip(i);
        let pre = self.source_level(i, c, t);
        if kind == LevelKind::PreFader {
            return pre;
        }
        let post = pre * db_to_lin(self.num(&s.gain()));
        if kind == LevelKind::PostFader {
            return post;
        }
        if self.num(&s.mute()) >= 0.5 {
            0.0
        } else {
            post
        }
    }

    fn bus_level(&self, j: usize, c: u32, t: f32) -> f32 {
        let b = params::bus(j);
        if self.num(&b.mute()) >= 0.5 {
            return 0.0;
        }
        let mut power = 0.0;
        for i in 0..STRIPS {
            if self.num(&params::strip(i).route(j)) < 0.5 {
                continue;
            }
            let chans = layout::strip_level_channels(i).len() as u32;
            if c < chans {
                let v = self.strip_post(i, c, t, LevelKind::PostMute);
                power += v * v;
            }
        }
        (power.sqrt() * db_to_lin(self.num(&b.gain()))).min(2.0)
    }
}

impl VmBackend for FakeBackend {
    fn kind(&self) -> BackendKind {
        BackendKind::Fake
    }
    fn vm_type(&self) -> Result<VmType, VmrError> {
        if self.missing.get() {
            return Err(VmrError::DllNotFound {
                searched: vec![std::path::PathBuf::from(
                    r"C:\Program Files (x86)\VB\Voicemeeter\VoicemeeterRemote64.dll (simulated)",
                )],
            });
        }
        self.running_now().ok_or(VmrError::NoServer)
    }
    fn vm_version(&self) -> Result<String, VmrError> {
        self.vm_version_parts().map(crate::vmr::format_version)
    }
    fn vm_version_parts(&self) -> Result<[u8; 4], VmrError> {
        match self.running_now() {
            Some(VmType::Potato) => Ok([3, 1, 3, 0]),
            Some(VmType::Banana) => Ok([2, 1, 3, 0]),
            Some(VmType::Basic) => Ok([1, 1, 3, 0]),
            None => Err(VmrError::NoServer),
        }
    }
    fn is_dirty(&mut self) -> Result<bool, VmrError> {
        self.require_server()?;
        Ok(std::mem::take(&mut self.dirty))
    }
    fn get_float(&self, name: &str) -> Result<f32, VmrError> {
        self.require_server()?;
        match self.params.get(name) {
            Some(Val::Num(v)) => Ok(*v),
            _ => Err(VmrError::UnknownParam(name.to_owned())),
        }
    }
    fn get_string(&self, name: &str) -> Result<String, VmrError> {
        self.require_server()?;
        match self.params.get(name) {
            Some(Val::Str(s)) => Ok(s.clone()),
            Some(Val::Num(v)) => Ok(params::script::fmt_float(*v)),
            None => Err(VmrError::UnknownParam(name.to_owned())),
        }
    }
    fn set_float(&mut self, name: &str, v: f32) -> Result<(), VmrError> {
        self.require_server()?;
        let w = self.plan_write(name, Val::Num(v))?;
        self.apply(w);
        Ok(())
    }
    fn set_string(&mut self, name: &str, v: &str) -> Result<(), VmrError> {
        self.require_server()?;
        let w = self.plan_write(name, Val::Str(v.to_owned()))?;
        self.apply(w);
        Ok(())
    }
    fn set_script(&mut self, script: &str) -> Result<(), VmrError> {
        self.require_server()?;
        if script.len() > params::script::MAX_BYTES {
            return Err(VmrError::InvalidInput("script is larger than 48 kB".into()));
        }
        // Validate every statement first, then apply: scripts are atomic.
        let mut writes = Vec::new();
        for (idx, stmt) in split_script(script).iter().enumerate() {
            let line = i32::try_from(idx + 1).unwrap_or(i32::MAX);
            let stmt = stmt.trim();
            if stmt.is_empty() {
                continue;
            }
            let (name, value) = parse_statement(stmt).ok_or(VmrError::ScriptLine(line))?;
            let w = self
                .plan_write(&name, value)
                .map_err(|_| VmrError::ScriptLine(line))?;
            writes.push(w);
        }
        for w in writes {
            self.apply(w);
        }
        Ok(())
    }
    fn get_level(&self, kind: LevelKind, channel: u32) -> Result<f32, VmrError> {
        self.require_server()?;
        if let Some(until) = self.restart_until
            && Instant::now() < until
        {
            return Ok(0.0);
        }
        let t = self.epoch.elapsed().as_secs_f32();
        if kind == LevelKind::Output {
            if channel >= layout::OUT_LEVEL_CH {
                return Err(VmrError::Code {
                    func: "VBVMR_GetLevel",
                    code: -4,
                });
            }
            let j = (channel / layout::BUS_CH) as usize;
            return Ok(self.bus_level(j, channel % layout::BUS_CH, t));
        }
        let strip = (0..STRIPS).find(|i| layout::strip_level_channels(*i).contains(&channel));
        match strip {
            Some(i) => {
                let c = channel - layout::strip_level_channels(i).start;
                Ok(self.strip_post(i, c, t, kind))
            }
            None => Err(VmrError::Code {
                func: "VBVMR_GetLevel",
                code: -4,
            }),
        }
    }
    fn input_devices(&self) -> Result<Vec<DeviceDesc>, VmrError> {
        self.require_server()?;
        Ok(self.inputs.clone())
    }
    fn output_devices(&self) -> Result<Vec<DeviceDesc>, VmrError> {
        self.require_server()?;
        Ok(self.outputs.clone())
    }
    fn run_voicemeeter(&mut self, _kind: RunKind) -> Result<(), VmrError> {
        if self.missing.get() {
            return Err(VmrError::NoServer);
        }
        if self.running_now().is_none() && self.launch_at.get().is_none() {
            self.launch_at.set(Some(Instant::now() + LAUNCH_DELAY));
        }
        Ok(())
    }
    fn as_fake_mut(&mut self) -> Option<&mut FakeBackend> {
        Some(self)
    }
}

enum Write {
    Set(String, Val),
    Device {
        name_param: String,
        sr_param: String,
        device: String,
    },
    Command(CommandKind),
    /// A name Voicemeeter parses but drops on this strip type (see `is_phantom`).
    Ignore,
}

#[derive(Clone, Copy)]
enum CommandKind {
    Restart,
    Other,
}

fn command_kind(name: &str) -> Option<CommandKind> {
    if name == params::command::restart() {
        return Some(CommandKind::Restart);
    }
    let fixed = [
        params::command::show(),
        params::command::save(),
        params::command::load(),
        params::command::lock(),
    ];
    if fixed.iter().any(|c| c == name) {
        return Some(CommandKind::Other);
    }
    let per_bus = (0..BUSES).any(|j| {
        name == params::command::save_bus_eq(j) || name == params::command::load_bus_eq(j)
    });
    per_bus.then_some(CommandKind::Other)
}

/// Write-only device selectors → (`device.name` param, `device.sr` param) they change.
fn device_target(name: &str) -> Option<(String, String)> {
    for i in (0..STRIPS).filter(|i| layout::is_hardware_strip(*i)) {
        let s = params::strip(i);
        if DeviceParam::ALL.iter().any(|k| name == s.device(*k)) {
            return Some((s.device_name(), s.device_sr()));
        }
    }
    for j in (0..BUSES).filter(|j| layout::is_physical_bus(*j)) {
        let b = params::bus(j);
        let ok = DeviceParam::ALL
            .iter()
            .filter(|k| **k != DeviceParam::Asio || j == 0) // ASIO: A1 only
            .any(|k| name == b.device(*k));
        if ok {
            return Some((b.device_name(), b.device_sr()));
        }
    }
    None
}

/// Params Voicemeeter 3.1.3.0 parses on a strip type that doesn't have the feature: reads return
/// a value, writes return OK and are silently dropped (verified with `vmr_probe`).
/// Virtual strips have no Comp / Gate / Denoiser; hardware strips have no `EQGain1..3`.
fn is_phantom(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("Strip[") else {
        return false;
    };
    let Some((idx, field)) = rest.split_once("].") else {
        return false;
    };
    let Ok(i) = idx.parse::<usize>() else {
        return false;
    };
    if layout::is_virtual_strip(i) {
        ["Comp", "Gate", "Denoiser"]
            .iter()
            .any(|f| field == *f || field.starts_with(&format!("{f}.")))
    } else if layout::is_hardware_strip(i) {
        field.starts_with("EQGain")
    } else {
        false
    }
}

fn is_read_only(name: &str) -> bool {
    name.ends_with(".device.name")
}

fn mode_bus(name: &str) -> Option<usize> {
    (0..BUSES).find(|j| {
        BusMode::ALL
            .iter()
            .any(|m| name == params::bus(*j).mode(*m))
    })
}

/// Clamp a numeric write to the cheatsheet range for that parameter.
fn clamp(name: &str, v: f32) -> f32 {
    let is_bus = name.starts_with("Bus[");
    let field = name.split_once("].").map(|(_, f)| f).unwrap_or(name);
    let bool01 = |v: f32| if v >= 0.5 { 1.0 } else { 0.0 };
    let range = |lo: f32, hi: f32| v.clamp(lo, hi);
    let int_range = |lo: f32, hi: f32| v.round().clamp(lo, hi);

    if let Some(cell_field) = field.rsplit_once('.').map(|(_, f)| f)
        && field.contains(".cell[")
    {
        return match cell_field {
            "on" => bool01(v),
            "type" => int_range(0.0, 6.0),
            "f" => range(20.0, 20_000.0),
            "gain" => range(-12.0, 12.0),
            "q" => range(1.0, 100.0),
            _ => v,
        };
    }
    if field.ends_with(".Trim") {
        return range(-24.0, 24.0);
    }
    if field.ends_with(".Delay") {
        return range(0.0, 500.0);
    }
    match field {
        "Gain" => range(-60.0, 12.0),
        "Mono" if is_bus => int_range(0.0, 2.0),
        "Mute" | "Solo" | "Mono" | "MC" | "A1" | "A2" | "A3" | "A4" | "A5" | "B1" | "B2" | "B3"
        | "Sel" | "Monitor" | "EQ.on" | "EQ.AB" | "Comp.MakeUp" => bool01(v),
        "Limit" if is_bus => range(-20.0, 12.0),
        "Limit" => range(-40.0, 12.0),
        "Comp" | "Gate" | "Denoiser" => range(0.0, 10.0),
        "EQGain1" | "EQGain2" | "EQGain3" => range(-12.0, 12.0),
        "Comp.GainIn" | "Comp.GainOut" => range(-24.0, 24.0),
        "Comp.Ratio" => range(1.0, 8.0),
        "Comp.Threshold" => range(-40.0, -3.0),
        "Comp.Attack" => range(0.0, 200.0),
        "Comp.Release" => range(0.0, 5000.0),
        "Comp.Knee" => range(0.0, 1.0),
        "Gate.Threshold" | "Gate.Damping" => range(-60.0, -10.0),
        "Gate.BPSidechain" => range(100.0, 4000.0),
        "Gate.Attack" => range(0.0, 1000.0),
        "Gate.Hold" | "Gate.Release" => range(0.0, 5000.0),
        _ => v,
    }
}

/// Splits a script at `;` and newlines, but not inside `"…"`.
fn split_script(script: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    for ch in script.chars() {
        match ch {
            '"' => {
                quoted = !quoted;
                cur.push(ch);
            }
            ';' | '\n' | '\r' if !quoted => {
                if ch != '\r' {
                    out.push(std::mem::take(&mut cur));
                }
            }
            _ => cur.push(ch),
        }
    }
    if !cur.trim().is_empty() {
        out.push(cur);
    }
    out
}

fn parse_statement(stmt: &str) -> Option<(String, Val)> {
    let (name, value) = stmt.split_once('=')?;
    let name = name.trim();
    let value = value.trim();
    if name.is_empty() || value.is_empty() {
        return None;
    }
    let v = if let Some(inner) = value.strip_prefix('"') {
        Val::Str(inner.strip_suffix('"')?.to_owned())
    } else {
        Val::Num(value.parse::<f32>().ok()?)
    };
    Some((name.to_owned(), v))
}

fn db_to_lin(db: f32) -> f32 {
    if db <= -60.0 {
        0.0
    } else {
        10f32.powf(db / 20.0)
    }
}

/// Cheap deterministic noise in 0..1.
fn noise(a: u32, b: u32) -> f32 {
    let mut x = a.wrapping_mul(0x9E37_79B9) ^ b.wrapping_mul(0x85EB_CA6B);
    x ^= x >> 15;
    x = x.wrapping_mul(0x2C1B_3C6D);
    x ^= x >> 12;
    (x & 0xFFFF) as f32 / 65535.0
}

// ---- Seed data ----

const STRIP_LABELS: [&str; STRIPS] = ["Mic", "Line In", "", "", "", "Desktop", "", ""];
const STRIP_GAINS: [f32; STRIPS] = [-3.5, -6.0, 0.0, 0.0, 0.0, -8.0, -12.0, 0.0];
const STRIP_DEVICES: [&str; 5] = [
    "Microphone (Shure MV7)",
    "Line In (Realtek(R) Audio)",
    "Analogue 1 + 2 (Focusrite USB Audio)",
    "",
    "",
];
/// Routes per strip, as bus indexes.
const STRIP_ROUTES: [&[usize]; STRIPS] = [&[0, 5], &[0], &[0, 5], &[], &[], &[0, 6], &[0, 1], &[]];
const BUS_LABELS: [&str; BUSES] = ["Speakers", "Headphones", "", "", "", "Stream", "", ""];
const BUS_GAINS: [f32; BUSES] = [0.0, -4.0, 0.0, 0.0, 0.0, -2.0, 0.0, 0.0];
const BUS_DEVICES: [&str; 5] = [
    "Speakers (Realtek(R) Audio)",
    "Headphones (Arctis 7 Game)",
    "",
    "",
    "",
];
const EQ_FREQS: [f32; 6] = [60.0, 250.0, 1000.0, 2500.0, 6000.0, 12000.0];
const EQ_CHANNELS: usize = 8;
const EQ_CELLS: usize = 6;

fn seed() -> HashMap<String, Val> {
    let mut m = HashMap::with_capacity(2400);
    let num = |m: &mut HashMap<String, Val>, k: String, v: f32| {
        m.insert(k, Val::Num(v));
    };

    for i in 0..STRIPS {
        let s = params::strip(i);
        let hw = layout::is_hardware_strip(i);
        num(&mut m, s.gain(), STRIP_GAINS[i]);
        num(&mut m, s.mute(), if i == 2 { 1.0 } else { 0.0 });
        num(&mut m, s.solo(), 0.0);
        if hw {
            num(&mut m, s.mono(), if i == 0 { 1.0 } else { 0.0 });
        } else {
            num(&mut m, s.mc(), 0.0);
        }
        for j in 0..BUSES {
            num(
                &mut m,
                s.route(j),
                if STRIP_ROUTES[i].contains(&j) {
                    1.0
                } else {
                    0.0
                },
            );
        }
        m.insert(s.label(), Val::Str(STRIP_LABELS[i].into()));
        num(&mut m, s.limit(), 12.0);
        num(&mut m, s.eq_on(), if i == 5 { 1.0 } else { 0.0 });
        num(&mut m, s.eq_ab(), 0.0);
        // Comp / Gate / Denoiser are seeded on virtual strips too: Voicemeeter answers reads
        // there (with its defaults) but drops writes (`is_phantom`).
        num(&mut m, s.comp(), if i == 0 { 3.5 } else { 0.0 });
        num(&mut m, s.gate(), if i == 0 { 2.0 } else { 0.0 });
        num(&mut m, s.denoiser(), if i == 0 { 4.0 } else { 0.0 });
        num(&mut m, s.comp_gain_in(), 0.0);
        num(&mut m, s.comp_ratio(), 3.0);
        num(&mut m, s.comp_threshold(), -20.0);
        num(&mut m, s.comp_attack(), 10.0);
        num(&mut m, s.comp_release(), 50.0);
        num(&mut m, s.comp_knee(), 0.5);
        num(&mut m, s.comp_gain_out(), 0.0);
        num(&mut m, s.comp_makeup(), 0.0);
        num(&mut m, s.gate_threshold(), -60.0);
        num(&mut m, s.gate_damping(), -60.0);
        num(&mut m, s.gate_bp_sidechain(), 100.0);
        num(&mut m, s.gate_attack(), 0.0);
        num(&mut m, s.gate_hold(), 500.0);
        num(&mut m, s.gate_release(), 1000.0);
        // Every strip has the 8×6 parametric EQ (virtual ones too, verified on 3.1.3.0).
        for ch in 0..EQ_CHANNELS {
            for cell in 0..EQ_CELLS {
                seed_strip_cell(&mut m, |f| s.eq_cell(ch, cell, f), cell, i == 0);
            }
        }
        if hw {
            m.insert(s.device_name(), Val::Str(STRIP_DEVICES[i].into()));
            num(
                &mut m,
                s.device_sr(),
                if STRIP_DEVICES[i].is_empty() {
                    0.0
                } else {
                    48000.0
                },
            );
        }
        // EQGain1..3 are real on virtual strips; on hardware strips they read 0 and drop writes.
        let gains: [f32; 3] = if i == 5 { [2.0, 0.0, -1.5] } else { [0.0; 3] };
        for (n, g) in (1..=3).zip(gains) {
            num(&mut m, s.eq_gain(n), g);
        }
    }

    for j in 0..BUSES {
        let b = params::bus(j);
        num(&mut m, b.gain(), BUS_GAINS[j]);
        num(&mut m, b.mute(), if j == 4 { 1.0 } else { 0.0 });
        num(&mut m, b.mono(), if j == 5 { 1.0 } else { 0.0 });
        num(&mut m, b.sel(), if j == 1 { 1.0 } else { 0.0 });
        num(&mut m, b.monitor(), 0.0);
        m.insert(b.label(), Val::Str(BUS_LABELS[j].into()));
        num(&mut m, b.limit(), 12.0);
        num(&mut m, b.eq_on(), if j == 0 { 1.0 } else { 0.0 });
        num(&mut m, b.eq_ab(), 0.0);
        for ch in 0..EQ_CHANNELS {
            for cell in 0..EQ_CELLS {
                seed_cell(&mut m, |f| b.eq_cell(ch, cell, f), cell, j == 0);
            }
            num(&mut m, b.eq_trim(ch), 0.0);
            num(&mut m, b.eq_delay(ch), 0.0);
        }
        let mode = if j == 7 {
            BusMode::Composite
        } else {
            BusMode::Normal
        };
        for md in BusMode::ALL {
            num(&mut m, b.mode(md), if md == mode { 1.0 } else { 0.0 });
        }
        if layout::is_physical_bus(j) {
            m.insert(b.device_name(), Val::Str(BUS_DEVICES[j].into()));
            num(
                &mut m,
                b.device_sr(),
                if BUS_DEVICES[j].is_empty() {
                    0.0
                } else {
                    48000.0
                },
            );
        }
    }
    m
}

/// Seeds one EQ cell. With `shaped`, cells 0 and 4 get a visible curve (bass lift, presence cut).
fn seed_cell(
    m: &mut HashMap<String, Val>,
    name: impl Fn(EqField) -> String,
    cell: usize,
    shaped: bool,
) {
    let (on, gain) = match (shaped, cell) {
        (true, 0) => (1.0, 3.0),
        (true, 4) => (1.0, -2.5),
        _ => (0.0, 0.0),
    };
    m.insert(name(EqField::On), Val::Num(on));
    m.insert(name(EqField::Type), Val::Num(0.0));
    m.insert(name(EqField::F), Val::Num(EQ_FREQS[cell]));
    m.insert(name(EqField::Gain), Val::Num(gain));
    m.insert(name(EqField::Q), Val::Num(2.0));
}

/// Voicemeeter's strip EQ cell defaults (read from an untouched strip on 3.1.3.0): every cell
/// on, type 0, Q 3, gain 0. With `shaped`, cells 1 and 4 get a gentle curve for the demo.
const STRIP_EQ_FREQS: [f32; 6] = [50.0, 200.0, 800.0, 2000.0, 8000.0, 12000.0];

fn seed_strip_cell(
    m: &mut HashMap<String, Val>,
    name: impl Fn(EqField) -> String,
    cell: usize,
    shaped: bool,
) {
    let gain = match (shaped, cell) {
        (true, 1) => -3.0,
        (true, 4) => 2.0,
        _ => 0.0,
    };
    m.insert(name(EqField::On), Val::Num(1.0));
    m.insert(name(EqField::Type), Val::Num(0.0));
    m.insert(name(EqField::F), Val::Num(STRIP_EQ_FREQS[cell]));
    m.insert(name(EqField::Gain), Val::Num(gain));
    m.insert(name(EqField::Q), Val::Num(3.0));
}

fn dev(kind: DeviceKind, name: &str, n: u32) -> DeviceDesc {
    DeviceDesc {
        kind,
        name: name.into(),
        hwid: format!("{{0.0.{n}.00000000}}.{{fake-{n:04x}}}"),
    }
}

/// Name of the device `FakeEvent::PlugDevice` adds and removes.
const USB_DEVICE: &str = "USB Audio Headset";

fn fake_inputs() -> Vec<DeviceDesc> {
    use DeviceKind::*;
    vec![
        dev(Wdm, "Microphone (Shure MV7)", 1),
        dev(Wdm, "Line In (Realtek(R) Audio)", 2),
        dev(Wdm, "Analogue 1 + 2 (Focusrite USB Audio)", 3),
        dev(Wdm, "Headset Microphone (Arctis 7 Chat)", 4),
        dev(Ks, "Shure MV7", 5),
        dev(Ks, "Realtek HD Audio Line input", 6),
        dev(Mme, "Microphone (Shure MV7)", 7),
        dev(Mme, "Line In (Realtek(R) Audio)", 8),
        dev(Asio, "Focusrite USB ASIO", 9),
    ]
}

fn fake_outputs() -> Vec<DeviceDesc> {
    use DeviceKind::*;
    vec![
        dev(Wdm, "Speakers (Realtek(R) Audio)", 11),
        dev(Wdm, "Headphones (Arctis 7 Game)", 12),
        dev(Wdm, "LG ULTRAGEAR (NVIDIA High Definition Audio)", 13),
        dev(Ks, "Realtek HD Audio output", 14),
        dev(Ks, "Arctis 7 Game", 15),
        dev(Mme, "Speakers (Realtek(R) Audio)", 16),
        dev(Mme, "Headphones (Arctis 7 Game)", 17),
        dev(Asio, "Focusrite USB ASIO", 18),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn running() -> FakeBackend {
        FakeBackend::new(FakeStart::Running)
    }

    #[test]
    fn reads_seeded_core_params() {
        let f = running();
        assert_eq!(f.get_float(&params::strip(0).gain()).unwrap(), -3.5);
        assert_eq!(f.get_string(&params::strip(0).label()).unwrap(), "Mic");
        assert_eq!(
            f.get_float(&params::bus(7).mode(BusMode::Composite))
                .unwrap(),
            1.0
        );
        assert!(f.get_float(&params::strip(5).eq_gain(1)).is_ok());
    }

    #[test]
    fn unknown_params_are_rejected() {
        let mut f = running();
        assert!(matches!(
            f.get_float("Strip[0].Nope"),
            Err(VmrError::UnknownParam(_))
        ));
        assert!(matches!(
            f.set_float("Strip[0].Nope", 1.0),
            Err(VmrError::UnknownParam(_))
        ));
    }

    #[test]
    fn strip_type_params_match_voicemeeter() {
        // Verified on 3.1.3.0: every strip has the parametric EQ; Comp/Gate/Denoiser on a
        // virtual strip and EQGain on a hardware strip read fine but drop writes.
        let mut f = running();
        let cell = params::strip(5).eq_cell(0, 0, EqField::Gain);
        f.set_float(&cell, 4.5).expect("virtual EQ cell");
        assert_eq!(f.get_float(&cell).ok(), Some(4.5));
        for name in [
            params::strip(5).comp_ratio(),
            params::strip(6).gate(),
            params::strip(7).denoiser(),
            params::strip(0).eq_gain(2),
        ] {
            let before = f.get_float(&name).expect("readable");
            let _ = f.is_dirty();
            f.set_float(&name, before + 1.0).expect("accepted");
            assert_eq!(
                f.get_float(&name).ok(),
                Some(before),
                "{name} must not change"
            );
            assert_eq!(f.is_dirty().ok(), Some(false), "{name} must not set dirty");
        }
    }

    #[test]
    fn writes_clamp_and_set_dirty() {
        let mut f = running();
        let _ = f.is_dirty();
        f.set_float(&params::strip(0).gain(), 40.0).unwrap();
        assert_eq!(f.get_float(&params::strip(0).gain()).unwrap(), 12.0);
        f.set_float(&params::bus(0).mono(), 7.0).unwrap();
        assert_eq!(f.get_float(&params::bus(0).mono()).unwrap(), 2.0);
        assert!(f.is_dirty().unwrap());
        assert!(!f.is_dirty().unwrap());
    }

    #[test]
    fn bus_mode_is_exclusive() {
        let mut f = running();
        let b = params::bus(3);
        f.set_float(&b.mode(BusMode::TvMix), 1.0).unwrap();
        let on: Vec<_> = BusMode::ALL
            .iter()
            .filter(|m| f.get_float(&b.mode(**m)).unwrap() >= 0.5)
            .collect();
        assert_eq!(on, vec![&BusMode::TvMix]);
    }

    #[test]
    fn device_selection_updates_name() {
        let mut f = running();
        let s = params::strip(3);
        f.set_string(&s.device(DeviceParam::Wdm), "Shure MV7")
            .unwrap();
        assert_eq!(f.get_string(&s.device_name()).unwrap(), "Shure MV7");
        f.set_string(&s.device(DeviceParam::Wdm), "").unwrap();
        assert_eq!(f.get_string(&s.device_name()).unwrap(), "");
        // device.name is read-only, ASIO is A1-only.
        assert!(f.set_string(&s.device_name(), "x").is_err());
        assert!(
            f.set_string(&params::bus(1).device(DeviceParam::Asio), "x")
                .is_err()
        );
        assert!(
            f.set_string(&params::bus(0).device(DeviceParam::Asio), "x")
                .is_ok()
        );
    }

    #[test]
    fn scripts_are_atomic() {
        let mut f = running();
        let ok = format!(
            "{} = -10; {} = 1\n{} = \"Vox; 1\"",
            params::strip(0).gain(),
            params::strip(0).mute(),
            params::strip(0).label()
        );
        f.set_script(&ok).unwrap();
        assert_eq!(f.get_float(&params::strip(0).gain()).unwrap(), -10.0);
        assert_eq!(f.get_string(&params::strip(0).label()).unwrap(), "Vox; 1");

        let bad = format!("{} = -20; Strip[0].Bogus = 1", params::strip(0).gain());
        assert_eq!(f.set_script(&bad), Err(VmrError::ScriptLine(2)));
        assert_eq!(f.get_float(&params::strip(0).gain()).unwrap(), -10.0);
    }

    #[test]
    fn levels_follow_mute_and_routing() {
        let mut f = running();
        let l = layout::strip_level_channels(0).start;
        // Strip 0 routes to A1; mute strip 0 → its post-mute level is 0.
        f.set_float(&params::strip(0).mute(), 1.0).unwrap();
        assert_eq!(f.get_level(LevelKind::PostMute, l).unwrap(), 0.0);
        // Pre-fader still shows the source.
        let pre: f32 = (0..50)
            .map(|_| f.get_level(LevelKind::PreFader, l).unwrap())
            .sum();
        assert!(pre > 0.0);
        // A muted bus is silent.
        f.set_float(&params::bus(0).mute(), 1.0).unwrap();
        assert_eq!(f.get_level(LevelKind::Output, 0).unwrap(), 0.0);
        assert!(f.get_level(LevelKind::Output, 64).is_err());
    }

    #[test]
    fn offline_launch_and_quit() {
        let mut f = FakeBackend::new(FakeStart::Offline);
        assert_eq!(f.vm_type(), Err(VmrError::NoServer));
        assert_eq!(f.is_dirty(), Err(VmrError::NoServer));
        f.run_voicemeeter(RunKind::PotatoX64).unwrap();
        f.launch_at.set(Some(Instant::now()));
        assert_eq!(f.vm_type(), Ok(VmType::Potato));
        f.simulate(FakeEvent::Quit);
        assert_eq!(f.vm_type(), Err(VmrError::NoServer));
        f.simulate(FakeEvent::StartBanana);
        assert_eq!(f.vm_type(), Ok(VmType::Banana));
    }

    #[test]
    fn missing_install_until_started() {
        let mut f = FakeBackend::new(FakeStart::Missing);
        assert!(matches!(f.vm_type(), Err(VmrError::DllNotFound { .. })));
        assert!(f.run_voicemeeter(RunKind::PotatoX64).is_err());
        f.simulate(FakeEvent::Start);
        assert_eq!(f.vm_type(), Ok(VmType::Potato));
    }

    #[test]
    fn env_values() {
        assert_eq!(FakeStart::from_env_value("1"), FakeStart::Running);
        assert_eq!(FakeStart::from_env_value("Offline"), FakeStart::Offline);
        assert_eq!(FakeStart::from_env_value("banana"), FakeStart::Banana);
        assert_eq!(FakeStart::from_env_value("missing"), FakeStart::Missing);
    }
}
