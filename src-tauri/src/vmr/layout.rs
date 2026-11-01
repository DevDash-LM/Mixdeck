//! Voicemeeter Potato layout: strip/bus counts and `GetLevel` channel ranges
//! (cheatsheet "Potato index map" and "Level channels").

use std::ops::Range;

/// All input strips (5 hardware + 3 virtual).
pub const STRIPS: usize = 8;
/// Hardware input strips, indices `0..HW_STRIPS`.
pub const HW_STRIPS: usize = 5;
/// Virtual strips: Virtual Input (VAIO), Virtual AUX, VAIO3.
pub const VIRTUAL_STRIPS: usize = STRIPS - HW_STRIPS;
/// All buses (A1–A5, B1–B3).
pub const BUSES: usize = 8;
/// Physical buses A1–A5, indices `0..PHYS_BUSES`.
pub const PHYS_BUSES: usize = 5;

/// Input level channels: 5 × 2 hardware + 3 × 8 virtual.
pub const IN_LEVEL_CH: u32 = 34;
/// Output level channels: 8 buses × 8.
pub const OUT_LEVEL_CH: u32 = 64;

/// Bus names by index. Also the routing parameter suffixes (`Strip[i].A1` …).
pub const BUS_NAMES: [&str; BUSES] = ["A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3"];

/// Default strip names (Voicemeeter's own, used when a strip has no label).
pub const STRIP_DEFAULT_NAMES: [&str; STRIPS] = [
    "Hardware Input 1",
    "Hardware Input 2",
    "Hardware Input 3",
    "Hardware Input 4",
    "Hardware Input 5",
    "Virtual Input",
    "Virtual AUX",
    "VAIO3",
];

/// Channels per hardware strip (L/R) and per virtual strip (8).
pub const HW_STRIP_CH: u32 = 2;
pub const VIRTUAL_STRIP_CH: u32 = 8;
pub const BUS_CH: u32 = 8;

pub const fn is_hardware_strip(i: usize) -> bool {
    i < HW_STRIPS
}

pub const fn is_virtual_strip(i: usize) -> bool {
    i >= HW_STRIPS && i < STRIPS
}

pub const fn is_physical_bus(j: usize) -> bool {
    j < PHYS_BUSES
}

/// Input level channels of strip `i` (for `GetLevel` types 0–2). Empty if `i` is out of range.
pub fn strip_level_channels(i: usize) -> Range<u32> {
    if i < HW_STRIPS {
        let start = i as u32 * HW_STRIP_CH;
        start..start + HW_STRIP_CH
    } else if i < STRIPS {
        let start = HW_STRIPS as u32 * HW_STRIP_CH + (i - HW_STRIPS) as u32 * VIRTUAL_STRIP_CH;
        start..start + VIRTUAL_STRIP_CH
    } else {
        0..0
    }
}

/// Output level channels of bus `j` (for `GetLevel` type 3). Empty if `j` is out of range.
pub fn bus_level_channels(j: usize) -> Range<u32> {
    if j < BUSES {
        let start = j as u32 * BUS_CH;
        start..start + BUS_CH
    } else {
        0..0
    }
}

/// Linear level → dBFS, floored at `floor_db` (the UI uses -60).
pub fn level_to_db(v: f32, floor_db: f32) -> f32 {
    let db = 20.0 * v.max(1e-6).log10();
    if db.is_nan() {
        floor_db
    } else {
        db.max(floor_db)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_channels_match_cheatsheet() {
        assert_eq!(strip_level_channels(0), 0..2);
        assert_eq!(strip_level_channels(4), 8..10);
        assert_eq!(strip_level_channels(5), 10..18);
        assert_eq!(strip_level_channels(6), 18..26);
        assert_eq!(strip_level_channels(7), 26..34);
        assert_eq!(strip_level_channels(8), 0..0);
    }

    #[test]
    fn strip_channels_are_contiguous_and_cover_all() {
        let mut next = 0;
        for i in 0..STRIPS {
            let r = strip_level_channels(i);
            assert_eq!(r.start, next, "strip {i}");
            next = r.end;
        }
        assert_eq!(next, IN_LEVEL_CH);
    }

    #[test]
    fn bus_channels() {
        assert_eq!(bus_level_channels(0), 0..8);
        assert_eq!(bus_level_channels(5), 40..48);
        assert_eq!(bus_level_channels(7).end, OUT_LEVEL_CH);
        assert!(bus_level_channels(8).is_empty());
    }

    #[test]
    fn kinds() {
        assert!(is_hardware_strip(4) && !is_hardware_strip(5));
        assert!(is_virtual_strip(5) && is_virtual_strip(7) && !is_virtual_strip(8));
        assert!(is_physical_bus(4) && !is_physical_bus(5));
        assert_eq!(BUS_NAMES[5], "B1");
    }

    #[test]
    fn db_conversion() {
        assert_eq!(level_to_db(1.0, -60.0), 0.0);
        assert!((level_to_db(0.5, -60.0) + 6.0206).abs() < 1e-3);
        assert_eq!(level_to_db(0.0, -60.0), -60.0);
        assert_eq!(level_to_db(-1.0, -60.0), -60.0);
        assert_eq!(level_to_db(f32::NAN, -60.0), -60.0);
    }
}
