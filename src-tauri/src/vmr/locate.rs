//! Finds `VoicemeeterRemote64.dll` in the user's Voicemeeter install. Registry first,
//! then the default install folder. Nothing is copied; the path is only returned.

use std::path::{Path, PathBuf};

use super::error::VmrError;

pub const DLL_NAME: &str = "VoicemeeterRemote64.dll";

/// Uninstall key written by the Voicemeeter installer (cheatsheet "DLL & lifecycle").
pub const UNINSTALL_KEY: &str =
    r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\VB:Voicemeeter {17359A74-1236-5467}";

/// Default install folder, used only when the registry has no usable entry.
pub const FALLBACK_DIR: &str = r"C:\Program Files (x86)\VB\Voicemeeter";

/// `KEY_WOW64_32KEY`: open the 32-bit registry view (the installer is 32-bit).
const KEY_WOW64_32KEY: u32 = 0x0200;

/// Where the DLL was found, plus everything that was tried.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Located {
    pub path: PathBuf,
    pub source: LocateSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocateSource {
    Registry,
    Registry32,
    Fallback,
}

/// Registry → fallback. The error lists every path that was searched.
pub fn locate_dll() -> Result<PathBuf, VmrError> {
    locate_dll_detailed().map(|l| l.path)
}

/// Like [`locate_dll`], but also says which source matched (for the probe and logs).
pub fn locate_dll_detailed() -> Result<Located, VmrError> {
    let mut candidates: Vec<(PathBuf, LocateSource)> = Vec::new();
    for (wow32, source) in [
        (false, LocateSource::Registry),
        (true, LocateSource::Registry32),
    ] {
        if let Some(dir) = registry_install_dir(wow32) {
            candidates.push((dir.join(DLL_NAME), source));
        }
    }
    if let Some(pf86) = std::env::var_os("ProgramFiles(x86)") {
        candidates.push((
            Path::new(&pf86).join(r"VB\Voicemeeter").join(DLL_NAME),
            LocateSource::Fallback,
        ));
    }
    candidates.push((
        Path::new(FALLBACK_DIR).join(DLL_NAME),
        LocateSource::Fallback,
    ));

    let mut searched: Vec<PathBuf> = Vec::new();
    for (path, source) in candidates {
        if searched.iter().any(|p| same_path(p, &path)) {
            continue;
        }
        if path.is_file() {
            return Ok(Located { path, source });
        }
        searched.push(path);
    }
    Err(VmrError::DllNotFound { searched })
}

fn same_path(a: &Path, b: &Path) -> bool {
    a.as_os_str().eq_ignore_ascii_case(b.as_os_str())
}

/// Reads `UninstallString` from HKLM (normal or 32-bit view) and returns its folder.
fn registry_install_dir(wow32: bool) -> Option<PathBuf> {
    let mut opts = windows_registry::LOCAL_MACHINE.options();
    opts.read();
    if wow32 {
        opts.access(KEY_WOW64_32KEY);
    }
    let key = opts.open(UNINSTALL_KEY).ok()?;
    let value = key.get_string("UninstallString").ok()?;
    dir_from_uninstall_string(&value)
}

/// `"C:\…\Voicemeeter\Voicemeeter8Setup.exe" /x` → `C:\…\Voicemeeter`.
/// Handles optional quotes and trailing arguments after a quoted path.
pub fn dir_from_uninstall_string(value: &str) -> Option<PathBuf> {
    let v = value.trim();
    let exe = if let Some(rest) = v.strip_prefix('"') {
        rest.split('"').next()?
    } else {
        v
    };
    let exe = exe.trim();
    if exe.is_empty() {
        return None;
    }
    let parent = Path::new(exe).parent()?;
    if parent.as_os_str().is_empty() {
        return None;
    }
    Some(parent.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uninstall_string_parsing() {
        assert_eq!(
            dir_from_uninstall_string(
                r"C:\Program Files (x86)\VB\Voicemeeter\Voicemeeter8Setup.exe"
            ),
            Some(PathBuf::from(r"C:\Program Files (x86)\VB\Voicemeeter"))
        );
        assert_eq!(
            dir_from_uninstall_string(r#" "D:\Apps\VB\Voicemeeter\setup.exe" /uninstall "#),
            Some(PathBuf::from(r"D:\Apps\VB\Voicemeeter"))
        );
        assert_eq!(dir_from_uninstall_string(""), None);
        assert_eq!(dir_from_uninstall_string(r#""""#), None);
        assert_eq!(dir_from_uninstall_string("setup.exe"), None);
    }
}
