//! The `devices` group: the audio devices Voicemeeter can use, for the device pickers on
//! hardware strips (inputs) and physical buses A1–A5 (outputs).
//!
//! The currently selected device isn't here: it's `Strip.device` / `Bus.device` in `core`
//! (`device.name`). The list is re-read on every dirty tick while subscribed and on
//! `refresh_group("devices")`, which the picker calls when it opens.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::vmr::{DeviceDesc, DeviceKind, VmrError};

use super::super::backend::VmBackend;
use super::{GroupId, GroupKind, ParamGroup};

pub const NAME: &str = "devices";

pub const KIND: GroupKind = GroupKind {
    name: NAME,
    build: |arg| match arg {
        None => Some(Box::new(Devices) as Box<dyn ParamGroup>),
        Some(_) => None,
    },
};

/// Driver type of a device. Each maps to one write-only selector param
/// (`device.wdm` / `.ks` / `.mme` / `.asio`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub enum DeviceDriver {
    Wdm,
    Ks,
    Mme,
    Asio,
}

impl DeviceDriver {
    fn from_kind(k: DeviceKind) -> Option<Self> {
        match k {
            DeviceKind::Wdm => Some(Self::Wdm),
            DeviceKind::Ks => Some(Self::Ks),
            DeviceKind::Mme => Some(Self::Mme),
            DeviceKind::Asio => Some(Self::Asio),
            DeviceKind::Other(_) => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct Device {
    pub driver: DeviceDriver,
    /// The name to write to `device.<driver>`; also what `device.name` reports once selected.
    pub name: String,
    pub hwid: String,
}

/// Data of the `devices` group. Devices of an unknown driver type are left out (they can't be
/// selected through the API).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct DeviceList {
    pub inputs: Vec<Device>,
    pub outputs: Vec<Device>,
}

struct Devices;

fn convert(list: Vec<DeviceDesc>) -> Vec<Device> {
    list.into_iter()
        .filter_map(|d| {
            let name = d.name.trim().to_owned();
            if name.is_empty() {
                return None;
            }
            Some(Device {
                driver: DeviceDriver::from_kind(d.kind)?,
                name,
                hwid: d.hwid,
            })
        })
        .collect()
}

pub fn read(b: &dyn VmBackend) -> Result<DeviceList, VmrError> {
    Ok(DeviceList {
        inputs: convert(b.input_devices()?),
        outputs: convert(b.output_devices()?),
    })
}

impl ParamGroup for Devices {
    fn id(&self) -> GroupId {
        NAME.to_owned()
    }

    fn read(&self, b: &dyn VmBackend) -> Result<serde_json::Value, VmrError> {
        serde_json::to_value(read(b)?).map_err(|e| VmrError::InvalidInput(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::super::resolve;
    use super::*;
    use crate::engine::fake::{FakeBackend, FakeStart};
    use crate::engine::state::FakeEvent;

    #[test]
    fn resolves_only_without_arg() {
        assert_eq!(resolve("devices").map(|g| g.id()), Ok("devices".into()));
        assert!(resolve("devices:1").is_err());
    }

    #[test]
    fn lists_fake_devices_and_follows_plug() {
        let mut f = FakeBackend::new(FakeStart::Running);
        let before = read(&f).expect("read");
        assert!(!before.inputs.is_empty() && !before.outputs.is_empty());
        assert!(
            before
                .outputs
                .iter()
                .any(|d| d.driver == DeviceDriver::Asio)
        );
        f.simulate(FakeEvent::PlugDevice);
        let after = read(&f).expect("read");
        assert!(after.inputs.len() > before.inputs.len());
        assert!(after.outputs.len() > before.outputs.len());
        f.simulate(FakeEvent::PlugDevice);
        assert_eq!(read(&f).expect("read"), before);
    }

    #[test]
    fn offline_is_no_server() {
        let f = FakeBackend::new(FakeStart::Offline);
        assert_eq!(read(&f), Err(VmrError::NoServer));
    }
}
