//! Parameter-name builders. **The only place in Rust that spells Voicemeeter parameter
//! names.** Every name here comes from `docs/reference/vmr-api-cheatsheet.md`; add new ones
//! there first. `src/lib/params.ts` mirrors this module for the frontend.
//!
//! Indices are not range-checked at runtime beyond a `debug_assert!`: an out-of-range name is
//! rejected by Voicemeeter as `VmrError::UnknownParam`, it never touches memory.

use super::layout::{BUS_NAMES, BUSES, STRIPS};

/// `Strip[i]`.
pub fn strip(i: usize) -> Strip {
    debug_assert!(i < STRIPS, "strip index {i} out of range");
    Strip(i)
}

/// `Bus[i]`.
pub fn bus(i: usize) -> Bus {
    debug_assert!(i < BUSES, "bus index {i} out of range");
    Bus(i)
}

/// Field of a parametric EQ cell (`….EQ.channel[j].cell[k].<field>`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EqField {
    On,
    /// `0..=6`. Shapes are uncalibrated; see the cheatsheet's CALIBRATE table.
    Type,
    /// Frequency, 20–20000 Hz.
    F,
    /// Gain, -12…+12 dB.
    Gain,
    /// Q, 1–100.
    Q,
}

impl EqField {
    pub const ALL: [EqField; 5] = [
        EqField::On,
        EqField::Type,
        EqField::F,
        EqField::Gain,
        EqField::Q,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            EqField::On => "on",
            EqField::Type => "type",
            EqField::F => "f",
            EqField::Gain => "gain",
            EqField::Q => "q",
        }
    }
}

/// Write-only device selector (`….device.<kind>`). An empty string unselects.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DeviceParam {
    Wdm,
    Ks,
    Mme,
    /// Bus A1 only for outputs.
    Asio,
}

impl DeviceParam {
    pub const ALL: [DeviceParam; 4] = [
        DeviceParam::Wdm,
        DeviceParam::Ks,
        DeviceParam::Mme,
        DeviceParam::Asio,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            DeviceParam::Wdm => "wdm",
            DeviceParam::Ks => "ks",
            DeviceParam::Mme => "mme",
            DeviceParam::Asio => "asio",
        }
    }
}

/// Bus modes (`Bus[i].mode.<name>`). Exactly one reads 1; write 1 to select.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BusMode {
    Normal,
    Amix,
    Bmix,
    Repeat,
    Composite,
    TvMix,
    UpMix21,
    UpMix41,
    UpMix61,
    CenterOnly,
    LfeOnly,
    RearOnly,
}

impl BusMode {
    pub const ALL: [BusMode; 12] = [
        BusMode::Normal,
        BusMode::Amix,
        BusMode::Bmix,
        BusMode::Repeat,
        BusMode::Composite,
        BusMode::TvMix,
        BusMode::UpMix21,
        BusMode::UpMix41,
        BusMode::UpMix61,
        BusMode::CenterOnly,
        BusMode::LfeOnly,
        BusMode::RearOnly,
    ];

    /// Suffix after `mode.`, cased as in the cheatsheet.
    pub const fn as_str(self) -> &'static str {
        match self {
            BusMode::Normal => "normal",
            BusMode::Amix => "Amix",
            BusMode::Bmix => "Bmix",
            BusMode::Repeat => "Repeat",
            BusMode::Composite => "Composite",
            BusMode::TvMix => "TVMix",
            BusMode::UpMix21 => "UpMix21",
            BusMode::UpMix41 => "UpMix41",
            BusMode::UpMix61 => "UpMix61",
            BusMode::CenterOnly => "CenterOnly",
            BusMode::LfeOnly => "LFEOnly",
            BusMode::RearOnly => "RearOnly",
        }
    }
}

fn bus_name(j: usize) -> &'static str {
    debug_assert!(j < BUSES, "bus index {j} out of range");
    BUS_NAMES.get(j).copied().unwrap_or("Bus?")
}

/// A strip parameter-name builder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Strip(pub usize);

impl Strip {
    fn p(&self, field: &str) -> String {
        format!("Strip[{}].{field}", self.0)
    }

    pub fn gain(&self) -> String {
        self.p("Gain")
    }
    pub fn mute(&self) -> String {
        self.p("Mute")
    }
    pub fn solo(&self) -> String {
        self.p("Solo")
    }
    pub fn mono(&self) -> String {
        self.p("Mono")
    }
    /// Mute center.
    pub fn mc(&self) -> String {
        self.p("MC")
    }
    /// Routing to bus `j` (`Strip[i].A1` … `B3`).
    pub fn route(&self, bus: usize) -> String {
        self.p(bus_name(bus))
    }
    pub fn label(&self) -> String {
        self.p("Label")
    }
    pub fn limit(&self) -> String {
        self.p("Limit")
    }
    pub fn denoiser(&self) -> String {
        self.p("Denoiser")
    }

    /// Simple Comp knob (0…10).
    pub fn comp(&self) -> String {
        self.p("Comp")
    }
    pub fn comp_gain_in(&self) -> String {
        self.p("Comp.GainIn")
    }
    pub fn comp_ratio(&self) -> String {
        self.p("Comp.Ratio")
    }
    pub fn comp_threshold(&self) -> String {
        self.p("Comp.Threshold")
    }
    pub fn comp_attack(&self) -> String {
        self.p("Comp.Attack")
    }
    pub fn comp_release(&self) -> String {
        self.p("Comp.Release")
    }
    pub fn comp_knee(&self) -> String {
        self.p("Comp.Knee")
    }
    pub fn comp_gain_out(&self) -> String {
        self.p("Comp.GainOut")
    }
    pub fn comp_makeup(&self) -> String {
        self.p("Comp.MakeUp")
    }

    /// Simple Gate knob (0…10).
    pub fn gate(&self) -> String {
        self.p("Gate")
    }
    pub fn gate_threshold(&self) -> String {
        self.p("Gate.Threshold")
    }
    pub fn gate_damping(&self) -> String {
        self.p("Gate.Damping")
    }
    pub fn gate_bp_sidechain(&self) -> String {
        self.p("Gate.BPSidechain")
    }
    pub fn gate_attack(&self) -> String {
        self.p("Gate.Attack")
    }
    pub fn gate_hold(&self) -> String {
        self.p("Gate.Hold")
    }
    pub fn gate_release(&self) -> String {
        self.p("Gate.Release")
    }

    pub fn eq_on(&self) -> String {
        self.p("EQ.on")
    }
    pub fn eq_ab(&self) -> String {
        self.p("EQ.AB")
    }
    /// Parametric EQ cell (**hardware strips only**), channel `ch` 0…7, cell 0…5.
    pub fn eq_cell(&self, ch: usize, cell: usize, field: EqField) -> String {
        self.p(&format!("EQ.channel[{ch}].cell[{cell}].{}", field.as_str()))
    }
    /// 3-band EQ gain `n` = 1…3 (**virtual strips only**).
    pub fn eq_gain(&self, n: u8) -> String {
        debug_assert!((1..=3).contains(&n), "EQGain{n} out of range");
        self.p(&format!("EQGain{n}"))
    }

    /// Write-only device selector.
    pub fn device(&self, kind: DeviceParam) -> String {
        self.p(&format!("device.{}", kind.as_str()))
    }
    /// Current device name (read-only).
    pub fn device_name(&self) -> String {
        self.p("device.name")
    }
    /// Current device sample rate (read-only).
    pub fn device_sr(&self) -> String {
        self.p("device.sr")
    }
}

/// A bus parameter-name builder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bus(pub usize);

impl Bus {
    fn p(&self, field: &str) -> String {
        format!("Bus[{}].{field}", self.0)
    }

    pub fn gain(&self) -> String {
        self.p("Gain")
    }
    pub fn mute(&self) -> String {
        self.p("Mute")
    }
    /// 0 off, 1 mono, 2 stereo reverse.
    pub fn mono(&self) -> String {
        self.p("Mono")
    }
    /// SEL button (used in place of a bus solo, which doesn't exist).
    pub fn sel(&self) -> String {
        self.p("Sel")
    }
    /// 1 exclusive select, 0 unselect all.
    pub fn monitor(&self) -> String {
        self.p("Monitor")
    }
    pub fn label(&self) -> String {
        self.p("Label")
    }
    pub fn limit(&self) -> String {
        self.p("Limit")
    }

    pub fn eq_on(&self) -> String {
        self.p("EQ.on")
    }
    pub fn eq_ab(&self) -> String {
        self.p("EQ.AB")
    }
    pub fn eq_cell(&self, ch: usize, cell: usize, field: EqField) -> String {
        self.p(&format!("EQ.channel[{ch}].cell[{cell}].{}", field.as_str()))
    }
    pub fn eq_trim(&self, ch: usize) -> String {
        self.p(&format!("EQ.channel[{ch}].Trim"))
    }
    pub fn eq_delay(&self, ch: usize) -> String {
        self.p(&format!("EQ.channel[{ch}].Delay"))
    }

    pub fn mode(&self, mode: BusMode) -> String {
        self.p(&format!("mode.{}", mode.as_str()))
    }

    pub fn device(&self, kind: DeviceParam) -> String {
        self.p(&format!("device.{}", kind.as_str()))
    }
    pub fn device_name(&self) -> String {
        self.p("device.name")
    }
    pub fn device_sr(&self) -> String {
        self.p("device.sr")
    }
}

/// `Command.*` (write-only actions).
pub mod command {
    /// Restart the audio engine (value 1).
    pub fn restart() -> String {
        "Command.Restart".into()
    }
    /// Show the Voicemeeter window (value 1).
    pub fn show() -> String {
        "Command.Show".into()
    }
    /// Save the full config to an .xml path (string).
    pub fn save() -> String {
        "Command.Save".into()
    }
    /// Load a full config .xml (string). Resets the rest of its script packet: send it alone.
    pub fn load() -> String {
        "Command.Load".into()
    }
    pub fn save_bus_eq(j: usize) -> String {
        format!("Command.SaveBUSEQ[{j}]")
    }
    pub fn load_bus_eq(j: usize) -> String {
        format!("Command.LoadBUSEQ[{j}]")
    }
    /// Lock the Voicemeeter GUI (0/1).
    pub fn lock() -> String {
        "Command.Lock".into()
    }
}

/// Scripts for `VBVMR_SetParameters`: atomic multi-parameter writes.
pub mod script {
    /// Hard limit from the SDK is "< 48 kB". Chunks stay at or under this many bytes
    /// (UTF-8, excluding the terminating NUL).
    pub const MAX_BYTES: usize = 48 * 1024 - 1;

    /// Turns a value into a script string literal. The PDF documents `"…"` quoting but no
    /// escape sequence, so characters that would end the literal or the line are replaced:
    /// `"` → `'`, CR/LF/TAB → space, NUL removed. (For exact labels use `set_string`,
    /// which has no quoting at all.)
    pub fn quote(value: &str) -> String {
        let mut out = String::with_capacity(value.len() + 2);
        out.push('"');
        for c in value.chars() {
            match c {
                '"' => out.push('\''),
                '\r' | '\n' | '\t' => out.push(' '),
                '\0' => {}
                c => out.push(c),
            }
        }
        out.push('"');
        out
    }

    /// Formats a float compactly (`-6`, `0.5`). Non-finite values become `0`.
    pub fn fmt_float(v: f32) -> String {
        if v.is_finite() {
            format!("{v}")
        } else {
            "0".into()
        }
    }

    /// Builds `name = value` lines and splits them into ≤ 48 kB chunks at line boundaries,
    /// so each chunk is applied atomically by one `set_script` call.
    #[derive(Debug, Clone, Default, PartialEq)]
    pub struct Builder {
        lines: Vec<String>,
    }

    impl Builder {
        pub fn new() -> Self {
            Self::default()
        }

        pub fn push_float(&mut self, name: &str, value: f32) -> &mut Self {
            self.lines.push(format!("{name} = {}", fmt_float(value)));
            self
        }

        pub fn push_bool(&mut self, name: &str, value: bool) -> &mut Self {
            self.lines.push(format!("{name} = {}", u8::from(value)));
            self
        }

        pub fn push_string(&mut self, name: &str, value: &str) -> &mut Self {
            self.lines.push(format!("{name} = {}", quote(value)));
            self
        }

        pub fn len(&self) -> usize {
            self.lines.len()
        }
        pub fn is_empty(&self) -> bool {
            self.lines.is_empty()
        }

        /// All lines joined with `\n` (may exceed 48 kB; use [`Builder::chunks`] to send).
        pub fn build(&self) -> String {
            self.lines.join("\n")
        }

        /// Scripts of at most [`MAX_BYTES`] each. A single line longer than the limit
        /// (only possible with a huge string value) gets its own chunk and will be rejected
        /// by `set_script` as invalid input rather than truncated.
        pub fn chunks(&self) -> Vec<String> {
            let mut out = Vec::new();
            let mut cur = String::new();
            for line in &self.lines {
                let extra = if cur.is_empty() {
                    line.len()
                } else {
                    line.len() + 1
                };
                if !cur.is_empty() && cur.len() + extra > MAX_BYTES {
                    out.push(std::mem::take(&mut cur));
                }
                if !cur.is_empty() {
                    cur.push('\n');
                }
                cur.push_str(line);
            }
            if !cur.is_empty() {
                out.push(cur);
            }
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::script::{Builder, MAX_BYTES, quote};
    use super::*;

    #[test]
    fn strip_names() {
        let s = strip(0);
        assert_eq!(s.gain(), "Strip[0].Gain");
        assert_eq!(s.mute(), "Strip[0].Mute");
        assert_eq!(s.solo(), "Strip[0].Solo");
        assert_eq!(s.mono(), "Strip[0].Mono");
        assert_eq!(s.mc(), "Strip[0].MC");
        assert_eq!(s.label(), "Strip[0].Label");
        assert_eq!(strip(3).route(0), "Strip[3].A1");
        assert_eq!(strip(3).route(4), "Strip[3].A5");
        assert_eq!(strip(3).route(7), "Strip[3].B3");
        assert_eq!(strip(1).comp_gain_in(), "Strip[1].Comp.GainIn");
        assert_eq!(strip(1).comp_makeup(), "Strip[1].Comp.MakeUp");
        assert_eq!(strip(1).gate_bp_sidechain(), "Strip[1].Gate.BPSidechain");
        assert_eq!(
            strip(2).eq_cell(1, 5, EqField::Gain),
            "Strip[2].EQ.channel[1].cell[5].gain"
        );
        assert_eq!(
            strip(2).eq_cell(0, 0, EqField::Type),
            "Strip[2].EQ.channel[0].cell[0].type"
        );
        assert_eq!(strip(5).eq_gain(3), "Strip[5].EQGain3");
        assert_eq!(strip(0).device(DeviceParam::Wdm), "Strip[0].device.wdm");
        assert_eq!(strip(0).device_name(), "Strip[0].device.name");
        assert_eq!(strip(7).denoiser(), "Strip[7].Denoiser");
    }

    #[test]
    fn bus_names() {
        let b = bus(5);
        assert_eq!(b.gain(), "Bus[5].Gain");
        assert_eq!(b.sel(), "Bus[5].Sel");
        assert_eq!(b.monitor(), "Bus[5].Monitor");
        assert_eq!(b.mode(BusMode::TvMix), "Bus[5].mode.TVMix");
        assert_eq!(b.mode(BusMode::Normal), "Bus[5].mode.normal");
        assert_eq!(b.mode(BusMode::LfeOnly), "Bus[5].mode.LFEOnly");
        assert_eq!(
            b.eq_cell(7, 5, EqField::Q),
            "Bus[5].EQ.channel[7].cell[5].q"
        );
        assert_eq!(b.eq_trim(2), "Bus[5].EQ.channel[2].Trim");
        assert_eq!(b.eq_delay(2), "Bus[5].EQ.channel[2].Delay");
        assert_eq!(bus(0).device(DeviceParam::Asio), "Bus[0].device.asio");
        assert_eq!(BusMode::ALL.len(), 12);
    }

    #[test]
    fn commands() {
        assert_eq!(command::restart(), "Command.Restart");
        assert_eq!(command::load(), "Command.Load");
        assert_eq!(command::save_bus_eq(2), "Command.SaveBUSEQ[2]");
        assert_eq!(command::load_bus_eq(0), "Command.LoadBUSEQ[0]");
    }

    #[test]
    fn quoting() {
        assert_eq!(quote("Mic"), r#""Mic""#);
        assert_eq!(quote(r#"My "Mic""#), r#""My 'Mic'""#);
        assert_eq!(quote("a\r\nb\tc\0d"), r#""a  b cd""#);
        assert_eq!(quote(""), r#""""#);
        assert_eq!(quote("Mikrofon ü"), "\"Mikrofon ü\"");
    }

    #[test]
    fn builder_lines() {
        let mut b = Builder::new();
        b.push_float(&strip(0).gain(), -6.0)
            .push_float(&strip(0).gain(), 0.5)
            .push_bool(&strip(0).route(5), true)
            .push_string(&strip(3).label(), r#"Skype "Caller""#)
            .push_float(&bus(0).gain(), f32::NAN);
        assert_eq!(
            b.build(),
            "Strip[0].Gain = -6\nStrip[0].Gain = 0.5\nStrip[0].B1 = 1\nStrip[3].Label = \"Skype 'Caller'\"\nBus[0].Gain = 0"
        );
        assert_eq!(b.chunks(), vec![b.build()]);
        assert_eq!(b.len(), 5);
        assert!(Builder::new().chunks().is_empty());
    }

    #[test]
    fn builder_chunks_at_line_boundaries() {
        let mut b = Builder::new();
        for ch in 0..8 {
            for cell in 0..6 {
                for f in EqField::ALL {
                    for i in 0..8 {
                        b.push_float(&bus(i).eq_cell(ch, cell, f), 1234.5);
                    }
                }
            }
        }
        let all = b.build();
        assert!(
            all.len() > MAX_BYTES,
            "test needs > 1 chunk, got {}",
            all.len()
        );
        let chunks = b.chunks();
        assert!(chunks.len() >= 2);
        for c in &chunks {
            assert!(c.len() <= MAX_BYTES);
            assert!(!c.starts_with('\n') && !c.ends_with('\n'));
        }
        // Rejoining gives back exactly the same script: nothing lost or split mid-line.
        assert_eq!(chunks.join("\n"), all);
    }

    #[test]
    fn oversized_single_line_gets_own_chunk() {
        let mut b = Builder::new();
        b.push_float("Strip[0].Gain", 1.0);
        b.push_string("Strip[0].Label", &"x".repeat(MAX_BYTES + 10));
        b.push_float("Strip[1].Gain", 1.0);
        let chunks = b.chunks();
        assert_eq!(chunks.len(), 3);
        assert!(chunks[1].len() > MAX_BYTES);
    }
}
