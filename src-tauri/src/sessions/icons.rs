//! App icons: exe path → the shell's large icon (32px at 100 % scaling) → PNG data URL.
//! Cached per exe path with a fixed bound. Runs on the sessions COM thread.

use std::collections::{HashMap, VecDeque};
use std::ffi::c_void;
use std::path::{Path, PathBuf};

use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, DIB_RGB_COLORS, DeleteDC,
    DeleteObject, GetDIBits, GetObjectW, HBITMAP, HGDIOBJ,
};
use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
use windows::Win32::UI::Shell::{SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGetFileInfoW};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};
use windows::core::HSTRING;

/// Most distinct exes kept. Each entry is a few kB.
pub const CACHE_MAX: usize = 64;

/// Bounded FIFO cache: exe path → icon data URL (or `None` when the exe had no usable icon,
/// so it isn't retried every scan).
#[derive(Default)]
pub struct IconCache {
    map: HashMap<PathBuf, Option<String>>,
    order: VecDeque<PathBuf>,
}

impl IconCache {
    pub fn get_or_load(&mut self, exe: &Path) -> Option<String> {
        if let Some(hit) = self.map.get(exe) {
            return hit.clone();
        }
        let icon = load_icon(exe);
        self.insert(exe.to_path_buf(), icon.clone());
        icon
    }

    fn insert(&mut self, key: PathBuf, value: Option<String>) {
        while self.order.len() >= CACHE_MAX {
            if let Some(old) = self.order.pop_front() {
                self.map.remove(&old);
            }
        }
        self.order.push_back(key.clone());
        self.map.insert(key, value);
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }
}

/// Never fails loudly: any GDI/shell error just means "no icon".
pub fn load_icon(exe: &Path) -> Option<String> {
    let (w, h, rgba) = icon_rgba(exe)?;
    let png = encode_png(w, h, &rgba)?;
    Some(data_url(&png))
}

fn icon_rgba(exe: &Path) -> Option<(u32, u32, Vec<u8>)> {
    let path = HSTRING::from(exe.as_os_str());
    let mut info = SHFILEINFOW::default();
    // SAFETY: `info` is a valid out-struct of the size passed; the path is NUL-terminated.
    let ok = unsafe {
        SHGetFileInfoW(
            &path,
            FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };
    if ok == 0 || info.hIcon.is_invalid() {
        return None;
    }
    let icon = OwnedIcon(info.hIcon);
    icon_to_rgba(icon.0)
}

struct OwnedIcon(HICON);
impl Drop for OwnedIcon {
    fn drop(&mut self) {
        // SAFETY: we own the icon returned by SHGetFileInfoW.
        let _ = unsafe { DestroyIcon(self.0) };
    }
}

struct OwnedBitmap(HBITMAP);
impl Drop for OwnedBitmap {
    fn drop(&mut self) {
        if !self.0.is_invalid() {
            // SAFETY: GetIconInfo hands us ownership of both bitmaps.
            let _ = unsafe { DeleteObject(HGDIOBJ(self.0.0)) };
        }
    }
}

fn icon_to_rgba(icon: HICON) -> Option<(u32, u32, Vec<u8>)> {
    let mut ii = ICONINFO::default();
    // SAFETY: valid icon handle and out-struct.
    unsafe { GetIconInfo(icon, &mut ii) }.ok()?;
    let color = OwnedBitmap(ii.hbmColor);
    let mask = OwnedBitmap(ii.hbmMask);
    if color.0.is_invalid() {
        return None; // monochrome icon; not worth handling
    }
    let mut bm = BITMAP::default();
    // SAFETY: `bm` is a BITMAP of the size passed.
    let n = unsafe {
        GetObjectW(
            HGDIOBJ(color.0.0),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bm as *mut BITMAP as *mut c_void),
        )
    };
    if n == 0 || bm.bmWidth <= 0 || bm.bmHeight <= 0 || bm.bmWidth > 256 || bm.bmHeight > 256 {
        return None;
    }
    let (w, h) = (bm.bmWidth as u32, bm.bmHeight as u32);
    let mut bgra = read_bits(color.0, w, h)?;
    let has_alpha = bgra.as_chunks::<4>().0.iter().any(|p| p[3] != 0);
    if !has_alpha {
        // Old-style icon: transparency lives in the AND mask (white = transparent).
        let m = read_bits(mask.0, w, h)?;
        for (p, mp) in bgra
            .as_chunks_mut::<4>()
            .0
            .iter_mut()
            .zip(m.as_chunks::<4>().0)
        {
            p[3] = if mp[0] == 0 { 255 } else { 0 };
        }
    }
    // BGRA → RGBA (straight alpha, which is what the shell's 32bpp icons use).
    for p in bgra.as_chunks_mut::<4>().0 {
        p.swap(0, 2);
    }
    Some((w, h, bgra))
}

/// Top-down 32bpp BGRA copy of a bitmap.
fn read_bits(bmp: HBITMAP, w: u32, h: u32) -> Option<Vec<u8>> {
    // SAFETY: a memory DC compatible with the screen; deleted below.
    let dc = unsafe { CreateCompatibleDC(None) };
    if dc.is_invalid() {
        return None;
    }
    let mut bi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w as i32,
            biHeight: -(h as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut buf = vec![0u8; (w * h * 4) as usize];
    // SAFETY: `buf` holds exactly h rows of w 32-bit pixels, as described by `bi`.
    let lines = unsafe {
        GetDIBits(
            dc,
            bmp,
            0,
            h,
            Some(buf.as_mut_ptr() as *mut c_void),
            &mut bi,
            DIB_RGB_COLORS,
        )
    };
    // SAFETY: created above.
    let _ = unsafe { DeleteDC(dc) };
    (lines == h as i32).then_some(buf)
}

pub fn encode_png(w: u32, h: u32, rgba: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
    }
    Some(out)
}

pub fn data_url(png: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64(png))
}

/// Standard base64 with padding (no extra dependency for one call site).
pub fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let b = [c[0], *c.get(1).unwrap_or(&0), *c.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        s.push(T[(n >> 18) as usize & 63] as char);
        s.push(T[(n >> 12) as usize & 63] as char);
        s.push(if c.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        s.push(if c.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_rfc4648_vectors() {
        let cases = [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
        ];
        for (i, o) in cases {
            assert_eq!(base64(i.as_bytes()), o);
        }
    }

    #[test]
    fn png_round_trips_header() {
        let png = encode_png(2, 2, &[255; 16]).expect("png");
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        assert!(data_url(&png).starts_with("data:image/png;base64,iVBORw0KGgo"));
    }

    #[test]
    fn cache_is_bounded() {
        let mut c = IconCache::default();
        for i in 0..(CACHE_MAX + 10) {
            c.insert(PathBuf::from(format!("C:/x/{i}.exe")), None);
        }
        assert_eq!(c.len(), CACHE_MAX);
        assert!(!c.map.contains_key(Path::new("C:/x/0.exe")));
        assert!(
            c.map
                .contains_key(&PathBuf::from(format!("C:/x/{}.exe", CACHE_MAX + 9)))
        );
    }
}
