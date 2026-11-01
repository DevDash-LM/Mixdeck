//! The `strip_fx:{i}` group: the detailed FX of one input strip, for the Strip FX drawer.
//!
//! What each strip type really has (checked with `vmr_probe --fx-check` plus write/read-back on
//! Voicemeeter Potato 3.1.3.0; Voicemeeter's parser never answers "unknown param" for these, it
//! silently drops writes to the ones a strip doesn't have):
//!
//! | | hardware 0–4 | virtual 5–7 |
//! |---|---|---|
//! | `Limit`, `EQ.on`, `EQ.AB`, 8×6 `EQ.channel[j].cell[k].*` | yes | yes |
//! | `Comp`, `Comp.*`, `Gate`, `Gate.*`, `Denoiser` | yes | no (writes dropped) |
//! | `EQGain1..3` | no (writes dropped) | yes |
//!
//! The strip-face knobs (`Comp`, `Gate`, `Denoiser`, `EQ.on`, `EQGain1..3`) are in `core`
//! (`Strip.quick`), so they're not read again here.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::vmr::VmrError;
use crate::vmr::layout::{self, STRIPS};
use crate::vmr::params::{self, EqField};

use super::super::backend::VmBackend;
use super::super::state::StripKind;
use super::{GroupId, GroupKind, Lenient, ParamGroup, index_arg};

pub const NAME: &str = "strip_fx";
/// Channels of a strip's parametric EQ (`EQ.channel[0..8]`).
pub const EQ_CHANNELS: usize = 8;
/// Cells (bands) per EQ channel (`cell[0..6]`).
pub const EQ_CELLS: usize = 6;

pub const KIND: GroupKind = GroupKind {
    name: NAME,
    build: |arg| index_arg(arg, STRIPS).map(|i| Box::new(StripFxGroup(i)) as Box<dyn ParamGroup>),
};

/// Group id for strip `i` (`"strip_fx:3"`).
pub fn id(i: usize) -> GroupId {
    format!("{NAME}:{i}")
}

/// Compressor details (hardware strips). The amount knob (`Comp`, 0–10) is `Strip.quick.comp`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct Comp {
    /// dB, -24..+24.
    pub gain_in: f32,
    /// 1..8.
    pub ratio: f32,
    /// dB, -40..-3.
    pub threshold: f32,
    /// ms, 0..200.
    pub attack: f32,
    /// ms, 0..5000.
    pub release: f32,
    /// 0..1.
    pub knee: f32,
    /// dB, -24..+24.
    pub gain_out: f32,
    /// Auto make-up gain.
    pub makeup: bool,
}

/// Gate details (hardware strips). The amount knob (`Gate`, 0–10) is `Strip.quick.gate`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct Gate {
    /// dB, -60..-10.
    pub threshold: f32,
    /// dB, -60..-10.
    pub damping: f32,
    /// Sidechain band-pass, Hz, 100..4000.
    pub bp_sidechain: f32,
    /// ms, 0..1000.
    pub attack: f32,
    /// ms, 0..5000.
    pub hold: f32,
    /// ms, 0..5000.
    pub release: f32,
}

/// One parametric EQ band. Shared with the bus EQ.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct EqCell {
    pub on: bool,
    /// Filter shape 0..6 (uncalibrated; see the cheatsheet's CALIBRATE table).
    pub kind: u8,
    /// Hz, 20..20000.
    pub f: f32,
    /// dB, -12..+12.
    pub gain: f32,
    /// 1..100.
    pub q: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct StripEqChannel {
    /// Always `EQ_CELLS` long.
    pub cells: Vec<EqCell>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct StripEq {
    /// `EQ.on` (also `Strip.quick.eqOn` on virtual strips).
    pub on: bool,
    /// `EQ.AB`: which of the two EQ memories is active (false = A, true = B).
    pub ab: bool,
    /// Always `EQ_CHANNELS` long.
    pub channels: Vec<StripEqChannel>,
}

/// Data of the `strip_fx:{i}` group. `comp`/`gate`/`denoiser` are `None` on virtual strips.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct StripFx {
    pub strip: u8,
    pub kind: StripKind,
    /// dB, -40..+12 (12 = off).
    pub limit: f32,
    pub comp: Option<Comp>,
    pub gate: Option<Gate>,
    /// 0..10 (hardware strips; also `Strip.quick.denoiser`).
    pub denoiser: Option<f32>,
    pub eq: StripEq,
}

struct StripFxGroup(usize);

/// Reads one EQ cell; `name(field)` builds its param name. Shared with the `bus_eq` group.
pub(super) fn read_cell(
    r: &Lenient<'_>,
    name: impl Fn(EqField) -> String,
) -> Result<EqCell, VmrError> {
    let kind = r.f32(&name(EqField::Type))?.round().clamp(0.0, 6.0);
    Ok(EqCell {
        on: r.bool(&name(EqField::On))?,
        // Clamped to 0..=6 above, so the cast can't truncate.
        kind: kind as u8,
        f: r.f32(&name(EqField::F))?,
        gain: r.f32(&name(EqField::Gain))?,
        q: r.f32(&name(EqField::Q))?,
    })
}

/// Reads strip `i`'s FX. Unknown params read as defaults (logged once), like `core`.
pub fn read(b: &dyn VmBackend, i: usize) -> Result<StripFx, VmrError> {
    let r = Lenient { b };
    let s = params::strip(i);
    let hw = layout::is_hardware_strip(i);

    let (comp, gate, denoiser) = if hw {
        let comp = Comp {
            gain_in: r.f32(&s.comp_gain_in())?,
            ratio: r.f32(&s.comp_ratio())?,
            threshold: r.f32(&s.comp_threshold())?,
            attack: r.f32(&s.comp_attack())?,
            release: r.f32(&s.comp_release())?,
            knee: r.f32(&s.comp_knee())?,
            gain_out: r.f32(&s.comp_gain_out())?,
            makeup: r.bool(&s.comp_makeup())?,
        };
        let gate = Gate {
            threshold: r.f32(&s.gate_threshold())?,
            damping: r.f32(&s.gate_damping())?,
            bp_sidechain: r.f32(&s.gate_bp_sidechain())?,
            attack: r.f32(&s.gate_attack())?,
            hold: r.f32(&s.gate_hold())?,
            release: r.f32(&s.gate_release())?,
        };
        (Some(comp), Some(gate), Some(r.f32(&s.denoiser())?))
    } else {
        (None, None, None)
    };

    let mut channels = Vec::with_capacity(EQ_CHANNELS);
    for ch in 0..EQ_CHANNELS {
        let mut cells = Vec::with_capacity(EQ_CELLS);
        for k in 0..EQ_CELLS {
            cells.push(read_cell(&r, |f| s.eq_cell(ch, k, f))?);
        }
        channels.push(StripEqChannel { cells });
    }

    Ok(StripFx {
        // `i < STRIPS` (8), so this never saturates.
        strip: u8::try_from(i).unwrap_or(u8::MAX),
        kind: if hw {
            StripKind::Hardware
        } else {
            StripKind::Virtual
        },
        limit: r.f32(&s.limit())?,
        comp,
        gate,
        denoiser,
        eq: StripEq {
            on: r.bool(&s.eq_on())?,
            ab: r.bool(&s.eq_ab())?,
            channels,
        },
    })
}

impl ParamGroup for StripFxGroup {
    fn id(&self) -> GroupId {
        id(self.0)
    }

    fn read(&self, b: &dyn VmBackend) -> Result<serde_json::Value, VmrError> {
        serde_json::to_value(read(b, self.0)?).map_err(|e| VmrError::InvalidInput(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::super::resolve;
    use super::*;
    use crate::engine::fake::{FakeBackend, FakeStart};

    #[test]
    fn resolves_strip_ids() {
        assert_eq!(
            resolve("strip_fx:0").map(|g| g.id()),
            Ok("strip_fx:0".into())
        );
        assert_eq!(
            resolve("strip_fx:7").map(|g| g.id()),
            Ok("strip_fx:7".into())
        );
        assert!(resolve("strip_fx:8").is_err());
        assert!(resolve("strip_fx").is_err());
        assert!(resolve("strip_fx:x").is_err());
    }

    #[test]
    fn hardware_strip_has_dynamics_and_eq() {
        let f = FakeBackend::new(FakeStart::Running);
        let fx = read(&f, 0).expect("read");
        assert_eq!(fx.kind, StripKind::Hardware);
        assert!(fx.comp.is_some() && fx.gate.is_some() && fx.denoiser.is_some());
        assert_eq!(fx.eq.channels.len(), EQ_CHANNELS);
        assert!(fx.eq.channels.iter().all(|c| c.cells.len() == EQ_CELLS));
        assert_eq!(fx.eq.channels[0].cells[0].f, 50.0);
    }

    #[test]
    fn virtual_strip_has_eq_only() {
        let f = FakeBackend::new(FakeStart::Running);
        let fx = read(&f, 6).expect("read");
        assert_eq!(fx.kind, StripKind::Virtual);
        assert!(fx.comp.is_none() && fx.gate.is_none() && fx.denoiser.is_none());
        assert_eq!(fx.eq.channels.len(), EQ_CHANNELS);
    }

    #[test]
    fn edits_round_trip() {
        let mut f = FakeBackend::new(FakeStart::Running);
        let s = params::strip(1);
        f.set_float(&s.comp_ratio(), 4.0).expect("set");
        f.set_float(&s.eq_cell(3, 2, EqField::Gain), -6.0)
            .expect("set");
        f.set_float(&s.limit(), -3.0).expect("set");
        let fx = read(&f, 1).expect("read");
        assert_eq!(fx.comp.map(|c| c.ratio), Some(4.0));
        assert_eq!(fx.eq.channels[3].cells[2].gain, -6.0);
        assert_eq!(fx.limit, -3.0);
    }

    #[test]
    fn offline_is_no_server() {
        let f = FakeBackend::new(FakeStart::Offline);
        assert_eq!(read(&f, 0).map(|_| ()), Err(VmrError::NoServer));
    }
}
