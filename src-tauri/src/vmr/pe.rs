//! Read-only inspection of a DLL file on disk: its file version and export names.
//! Parses the PE bytes directly; the DLL is never loaded, copied or modified.
//! Used by `vmr_probe` for the version check and by About/logs.

use std::path::Path;

use super::error::VmrError;
use super::ffi::{HEADER_EXPORTS, HEADER_INTERNAL};

const IMAGE_FILE_MACHINE_AMD64: u16 = 0x8664;
const VS_FFI_SIGNATURE: u32 = 0xFEEF_04BD;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DllFileInfo {
    /// `VS_FIXEDFILEINFO` file version, e.g. `[1, 1, 3, 0]`.
    pub file_version: Option<[u16; 4]>,
    pub product_version: Option<[u16; 4]>,
    /// True when the PE machine is x86-64.
    pub is_x64: bool,
    /// Export names, in the DLL's (sorted) name-table order.
    pub exports: Vec<String>,
}

impl DllFileInfo {
    pub fn file_version_string(&self) -> Option<String> {
        self.file_version.map(fmt_version)
    }
}

pub fn fmt_version(v: [u16; 4]) -> String {
    format!("{}.{}.{}.{}", v[0], v[1], v[2], v[3])
}

/// Exports diff between the DLL and `VoicemeeterRemote.h`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ExportReport {
    /// Declared in the header but not exported by the DLL.
    pub missing_from_dll: Vec<&'static str>,
    /// Exported by the DLL but not declared in the header (excluding known-internal ones).
    pub not_in_header: Vec<String>,
}

pub fn compare_exports(exports: &[String]) -> ExportReport {
    let missing_from_dll = HEADER_EXPORTS
        .iter()
        .copied()
        .filter(|h| !exports.iter().any(|e| e == h))
        .collect();
    let not_in_header = exports
        .iter()
        .filter(|e| !HEADER_EXPORTS.contains(&e.as_str()) && !HEADER_INTERNAL.contains(&e.as_str()))
        .cloned()
        .collect();
    ExportReport {
        missing_from_dll,
        not_in_header,
    }
}

/// Reads the file (read-only) and parses version + exports.
pub fn inspect_dll(path: &Path) -> Result<DllFileInfo, VmrError> {
    let bytes =
        std::fs::read(path).map_err(|e| VmrError::Load(format!("{}: {e}", path.display())))?;
    parse_pe(&bytes)
        .ok_or_else(|| VmrError::Load(format!("{}: not a valid PE image", path.display())))
}

fn u16_at(b: &[u8], off: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        b.get(off..off.checked_add(2)?)?.try_into().ok()?,
    ))
}

fn u32_at(b: &[u8], off: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        b.get(off..off.checked_add(4)?)?.try_into().ok()?,
    ))
}

struct Section {
    va: u32,
    vsize: u32,
    raw_ptr: u32,
    raw_size: u32,
}

fn rva_to_off(sections: &[Section], rva: u32) -> Option<usize> {
    sections.iter().find_map(|s| {
        let span = s.vsize.max(s.raw_size);
        if rva >= s.va && rva < s.va.checked_add(span)? {
            let delta = rva - s.va;
            (delta < s.raw_size).then(|| (s.raw_ptr + delta) as usize)
        } else {
            None
        }
    })
}

/// Parses a PE image. `None` if the bytes aren't a PE file.
pub fn parse_pe(b: &[u8]) -> Option<DllFileInfo> {
    if b.get(0..2)? != b"MZ" {
        return None;
    }
    let pe = u32_at(b, 0x3C)? as usize;
    if b.get(pe..pe + 4)? != b"PE\0\0" {
        return None;
    }
    let coff = pe + 4;
    let machine = u16_at(b, coff)?;
    let n_sections = u16_at(b, coff + 2)? as usize;
    let opt_size = u16_at(b, coff + 16)? as usize;
    let opt = coff + 20;
    let (n_dirs_off, dirs_off) = match u16_at(b, opt)? {
        0x20B => (opt + 108, opt + 112), // PE32+
        0x10B => (opt + 92, opt + 96),   // PE32
        _ => return None,
    };
    let n_dirs = u32_at(b, n_dirs_off)? as usize;
    let dir = |i: usize| -> Option<(u32, u32)> {
        if i >= n_dirs {
            return None;
        }
        let o = dirs_off + i * 8;
        Some((u32_at(b, o)?, u32_at(b, o + 4)?))
    };

    let sec_table = opt + opt_size;
    let mut sections = Vec::with_capacity(n_sections);
    for i in 0..n_sections {
        let s = sec_table + i * 40;
        sections.push(Section {
            vsize: u32_at(b, s + 8)?,
            va: u32_at(b, s + 12)?,
            raw_size: u32_at(b, s + 16)?,
            raw_ptr: u32_at(b, s + 20)?,
        });
    }

    let mut exports = Vec::new();
    if let Some((rva, _)) = dir(0).filter(|(rva, _)| *rva != 0)
        && let Some(ed) = rva_to_off(&sections, rva)
    {
        let n_names = u32_at(b, ed + 24).unwrap_or(0) as usize;
        let names_rva = u32_at(b, ed + 32).unwrap_or(0);
        if let Some(names) = rva_to_off(&sections, names_rva) {
            for i in 0..n_names.min(65_536) {
                let Some(name_rva) = u32_at(b, names + i * 4) else {
                    break;
                };
                let Some(no) = rva_to_off(&sections, name_rva) else {
                    continue;
                };
                let Some(tail) = b.get(no..) else { continue };
                let end = tail
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(tail.len())
                    .min(512);
                exports.push(String::from_utf8_lossy(&tail[..end]).into_owned());
            }
        }
    }

    // VS_FIXEDFILEINFO lives in the resource section; search there, else the whole file.
    let res_range = dir(2)
        .filter(|(rva, _)| *rva != 0)
        .and_then(|(rva, size)| {
            let start = rva_to_off(&sections, rva)?;
            Some(start..start.saturating_add(size as usize).min(b.len()))
        })
        .unwrap_or(0..b.len());
    let (file_version, product_version) = find_fixed_file_info(b.get(res_range)?)
        .map(|(f, p)| (Some(f), Some(p)))
        .unwrap_or((None, None));

    Some(DllFileInfo {
        file_version,
        product_version,
        is_x64: machine == IMAGE_FILE_MACHINE_AMD64,
        exports,
    })
}

/// Finds `VS_FIXEDFILEINFO` (signature, struc version, file MS/LS, product MS/LS).
fn find_fixed_file_info(b: &[u8]) -> Option<([u16; 4], [u16; 4])> {
    let sig = VS_FFI_SIGNATURE.to_le_bytes();
    let mut i = 0;
    while i + 24 <= b.len() {
        if b[i..i + 4] == sig && u32_at(b, i + 4)? >> 16 == 1 {
            let split =
                |ms: u32, ls: u32| [(ms >> 16) as u16, ms as u16, (ls >> 16) as u16, ls as u16];
            let f = split(u32_at(b, i + 8)?, u32_at(b, i + 12)?);
            let p = split(u32_at(b, i + 16)?, u32_at(b, i + 20)?);
            return Some((f, p));
        }
        i += 4; // the struct is DWORD-aligned
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_file_info_scan() {
        let mut b = vec![0u8; 8];
        b.extend_from_slice(&VS_FFI_SIGNATURE.to_le_bytes());
        b.extend_from_slice(&0x0001_0000u32.to_le_bytes());
        b.extend_from_slice(&0x0001_0001u32.to_le_bytes()); // 1.1
        b.extend_from_slice(&0x0003_0000u32.to_le_bytes()); // .3.0
        b.extend_from_slice(&0x0003_0001u32.to_le_bytes());
        b.extend_from_slice(&0x0003_0000u32.to_le_bytes());
        let (f, p) = find_fixed_file_info(&b).expect("found");
        assert_eq!(f, [1, 1, 3, 0]);
        assert_eq!(p, [3, 1, 3, 0]);
        assert_eq!(fmt_version(f), "1.1.3.0");
    }

    #[test]
    fn rejects_non_pe() {
        assert!(parse_pe(b"not a dll").is_none());
        assert!(parse_pe(&[]).is_none());
    }

    #[test]
    fn export_diff() {
        let mut exports: Vec<String> = HEADER_EXPORTS.iter().map(|s| s.to_string()).collect();
        exports.retain(|e| e != "VBVMR_SetCustomButton");
        exports.push("VBVMR_SetHinstance".into());
        exports.push("VBVMR_NewThing".into());
        let r = compare_exports(&exports);
        assert_eq!(r.missing_from_dll, vec!["VBVMR_SetCustomButton"]);
        assert_eq!(r.not_in_header, vec!["VBVMR_NewThing".to_string()]);
    }

    /// Parses a real system DLL (read-only) to exercise the PE walker end to end.
    #[test]
    fn parses_system_dll() {
        let Some(root) = std::env::var_os("SystemRoot") else {
            return;
        };
        let path = Path::new(&root).join(r"System32\kernel32.dll");
        if !path.is_file() {
            return;
        }
        let info = inspect_dll(&path).expect("kernel32 parses");
        assert!(info.is_x64);
        assert!(info.exports.iter().any(|e| e == "LoadLibraryW"));
        assert!(info.file_version.is_some());
    }
}
