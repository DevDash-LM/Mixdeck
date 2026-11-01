//! The `core` group: everything on the Mixer page, about 280 reads.

use crate::vmr::VmrError;
use crate::vmr::layout::{self, BUSES, STRIPS};
use crate::vmr::params;

use super::super::backend::VmBackend;
use super::super::state::{Bus, BusMode, HardwareQuick, Strip, StripQuick, VirtualQuick};
use super::Lenient;

/// Reads all strips and buses. Only `NoServer` is returned as an error.
pub fn read(b: &dyn VmBackend) -> Result<(Vec<Strip>, Vec<Bus>), VmrError> {
    let r = Lenient { b };
    let strips = (0..STRIPS)
        .map(|i| read_strip(&r, i))
        .collect::<Result<Vec<_>, _>>()?;
    let buses = (0..BUSES)
        .map(|j| read_bus(&r, j))
        .collect::<Result<Vec<_>, _>>()?;
    Ok((strips, buses))
}

fn device(name: String) -> Option<String> {
    let t = name.trim();
    (!t.is_empty()).then(|| t.to_owned())
}

fn read_strip(r: &Lenient<'_>, i: usize) -> Result<Strip, VmrError> {
    let p = params::strip(i);
    let hw = layout::is_hardware_strip(i);
    let mut s = Strip::empty(i);
    s.label = r.string(&p.label())?;
    s.gain = r.f32(&p.gain())?;
    s.mute = r.bool(&p.mute())?;
    s.solo = r.bool(&p.solo())?;
    for (j, route) in s.routes.iter_mut().enumerate() {
        *route = r.bool(&p.route(j))?;
    }
    if hw {
        s.mono = r.bool(&p.mono())?;
        s.device = device(r.string(&p.device_name())?);
        s.quick = StripQuick::Hardware(HardwareQuick {
            comp: r.f32(&p.comp())?,
            gate: r.f32(&p.gate())?,
            denoiser: r.f32(&p.denoiser())?,
        });
    } else {
        s.mc = r.bool(&p.mc())?;
        s.quick = StripQuick::Virtual(VirtualQuick {
            eq_on: r.bool(&p.eq_on())?,
            eq_gain: [
                r.f32(&p.eq_gain(1))?,
                r.f32(&p.eq_gain(2))?,
                r.f32(&p.eq_gain(3))?,
            ],
        });
    }
    Ok(s)
}

fn read_bus(r: &Lenient<'_>, j: usize) -> Result<Bus, VmrError> {
    let p = params::bus(j);
    let mut b = Bus::empty(j);
    b.label = r.string(&p.label())?;
    b.gain = r.f32(&p.gain())?;
    b.mute = r.bool(&p.mute())?;
    b.mono = r.f32(&p.mono())?.round().clamp(0.0, 2.0) as u8;
    b.sel = r.bool(&p.sel())?;
    b.eq_on = r.bool(&p.eq_on())?;
    b.mode = BusMode::Normal;
    for m in params::BusMode::ALL {
        if r.bool(&p.mode(m))? {
            b.mode = BusMode::from_vmr(m);
            break;
        }
    }
    if layout::is_physical_bus(j) {
        b.device = device(r.string(&p.device_name())?);
    }
    Ok(b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::fake::{FakeBackend, FakeStart};
    use crate::engine::state::{BusKind, StripKind};

    #[test]
    fn reads_fake_mixer() {
        let f = FakeBackend::new(FakeStart::Running);
        let (strips, buses) = read(&f).unwrap();
        assert_eq!(strips.len(), 8);
        assert_eq!(buses.len(), 8);
        assert_eq!(strips[0].kind, StripKind::Hardware);
        assert_eq!(strips[0].label, "Mic");
        assert!(strips[0].mono);
        assert_eq!(strips[0].device.as_deref(), Some("Microphone (Shure MV7)"));
        assert!(matches!(strips[0].quick, StripQuick::Hardware(q) if q.comp == 3.5));
        assert_eq!(strips[5].kind, StripKind::Virtual);
        assert!(
            matches!(strips[5].quick, StripQuick::Virtual(q) if q.eq_on && q.eq_gain[0] == 2.0)
        );
        assert_eq!(strips[3].device, None);
        assert_eq!(buses[5].kind, BusKind::Virtual);
        assert_eq!(buses[5].mono, 1);
        assert_eq!(buses[7].mode, BusMode::Composite);
        assert_eq!(
            buses[0].device.as_deref(),
            Some("Speakers (Realtek(R) Audio)")
        );
    }

    #[test]
    fn no_server_propagates() {
        let f = FakeBackend::new(FakeStart::Offline);
        assert_eq!(read(&f).err(), Some(VmrError::NoServer));
    }
}
