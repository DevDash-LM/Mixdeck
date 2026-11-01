//! The `bus_eq:{j}` group: one bus's parametric EQ for the Bus EQ editor.
//!
//! Every bus has `EQ.on`, `EQ.AB` and 8 channels, each with `Trim`, `Delay` and 6 cells
//! (cheatsheet "Bus parameters"). `EQ.on` is also `Bus.eqOn` in `core` (the Mixer's EQ chip);
//! it's read again here so the editor has one consistent snapshot. About 260 reads.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::vmr::VmrError;
use crate::vmr::layout::{self, BUSES};
use crate::vmr::params;

use super::super::backend::VmBackend;
use super::super::state::BusKind;
use super::strip_fx::{EQ_CELLS, EQ_CHANNELS, EqCell, read_cell};
use super::{GroupId, GroupKind, Lenient, ParamGroup, index_arg};

pub const NAME: &str = "bus_eq";

pub const KIND: GroupKind = GroupKind {
    name: NAME,
    build: |arg| index_arg(arg, BUSES).map(|j| Box::new(BusEqGroup(j)) as Box<dyn ParamGroup>),
};

/// Group id for bus `j` (`"bus_eq:0"`).
pub fn id(j: usize) -> GroupId {
    format!("{NAME}:{j}")
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct BusEqChannel {
    /// `EQ.channel[c].Trim`, dB, -24..+24.
    pub trim: f32,
    /// `EQ.channel[c].Delay`, ms, 0..500.
    pub delay: f32,
    /// Always `EQ_CELLS` long.
    pub cells: Vec<EqCell>,
}

/// Data of the `bus_eq:{j}` group.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct BusEq {
    pub bus: u8,
    pub kind: BusKind,
    /// `EQ.on`.
    pub on: bool,
    /// `EQ.AB`: which EQ memory is active (false = A, true = B).
    pub ab: bool,
    /// The output device's sample rate (`device.sr`, physical buses with a device), for the
    /// response curve. `None` when unknown; the UI assumes 48 kHz.
    pub sample_rate: Option<f32>,
    /// Always `EQ_CHANNELS` long.
    pub channels: Vec<BusEqChannel>,
}

struct BusEqGroup(usize);

/// Reads bus `j`'s EQ. Unknown params read as defaults (logged once), like `core`.
pub fn read(b: &dyn VmBackend, j: usize) -> Result<BusEq, VmrError> {
    let r = Lenient { b };
    let p = params::bus(j);
    let physical = layout::is_physical_bus(j);

    let sample_rate = if physical {
        let sr = r.f32(&p.device_sr())?;
        // A plausible audio rate, else unknown (no device reads 0).
        (8_000.0..=768_000.0).contains(&sr).then_some(sr)
    } else {
        None
    };

    let mut channels = Vec::with_capacity(EQ_CHANNELS);
    for ch in 0..EQ_CHANNELS {
        let mut cells = Vec::with_capacity(EQ_CELLS);
        for k in 0..EQ_CELLS {
            cells.push(read_cell(&r, |f| p.eq_cell(ch, k, f))?);
        }
        channels.push(BusEqChannel {
            trim: r.f32(&p.eq_trim(ch))?,
            delay: r.f32(&p.eq_delay(ch))?,
            cells,
        });
    }

    Ok(BusEq {
        // `j < BUSES` (8), so this never saturates.
        bus: u8::try_from(j).unwrap_or(u8::MAX),
        kind: if physical {
            BusKind::Physical
        } else {
            BusKind::Virtual
        },
        on: r.bool(&p.eq_on())?,
        ab: r.bool(&p.eq_ab())?,
        sample_rate,
        channels,
    })
}

impl ParamGroup for BusEqGroup {
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
    use crate::vmr::params::EqField;

    #[test]
    fn resolves_bus_ids() {
        assert_eq!(resolve("bus_eq:0").map(|g| g.id()), Ok("bus_eq:0".into()));
        assert_eq!(resolve("bus_eq:7").map(|g| g.id()), Ok("bus_eq:7".into()));
        assert!(resolve("bus_eq:8").is_err());
        assert!(resolve("bus_eq").is_err());
        assert!(resolve("bus_eq:-1").is_err());
    }

    #[test]
    fn reads_shape_and_seed() {
        let f = FakeBackend::new(FakeStart::Running);
        let eq = read(&f, 0).expect("read");
        assert_eq!(eq.kind, BusKind::Physical);
        assert!(eq.on);
        assert_eq!(eq.channels.len(), EQ_CHANNELS);
        assert!(eq.channels.iter().all(|c| c.cells.len() == EQ_CELLS));
        // The fake shapes A1's cell 0 (+3 dB).
        assert_eq!(eq.channels[0].cells[0].gain, 3.0);
        assert_eq!(eq.sample_rate, Some(48_000.0));

        let b3 = read(&f, 7).expect("read");
        assert_eq!(b3.kind, BusKind::Virtual);
        assert_eq!(b3.sample_rate, None);
    }

    #[test]
    fn edits_round_trip() {
        let mut f = FakeBackend::new(FakeStart::Running);
        let p = params::bus(2);
        f.set_float(&p.eq_cell(5, 3, EqField::F), 1234.0)
            .expect("set");
        f.set_float(&p.eq_cell(5, 3, EqField::Type), 4.0)
            .expect("set");
        f.set_float(&p.eq_trim(5), -6.0).expect("set");
        f.set_float(&p.eq_delay(1), 12.5).expect("set");
        let eq = read(&f, 2).expect("read");
        assert_eq!(eq.channels[5].cells[3].f, 1234.0);
        assert_eq!(eq.channels[5].cells[3].kind, 4);
        assert_eq!(eq.channels[5].trim, -6.0);
        assert_eq!(eq.channels[1].delay, 12.5);
    }

    #[test]
    fn linked_script_applies_to_all_channels() {
        let mut f = FakeBackend::new(FakeStart::Running);
        let p = params::bus(1);
        let mut s = params::script::Builder::new();
        for ch in 0..EQ_CHANNELS {
            s.push_float(&p.eq_cell(ch, 2, EqField::Gain), -4.5);
        }
        f.set_script(&s.build()).expect("script");
        let eq = read(&f, 1).expect("read");
        assert!(eq.channels.iter().all(|c| c.cells[2].gain == -4.5));
    }

    #[test]
    fn offline_is_no_server() {
        let f = FakeBackend::new(FakeStart::Offline);
        assert_eq!(read(&f, 0).map(|_| ()), Err(VmrError::NoServer));
    }
}
