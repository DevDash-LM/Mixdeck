//! `VmrClient`: owns the loaded DLL and wraps every call in a typed, safe API.
//!
//! Threading: the client is `Send` but `!Sync`. Move it onto one worker thread and make
//! every call there (the SDK requires `IsParametersDirty`/`GetLevel` from one thread only).

use std::cell::Cell;
use std::ffi::{CString, c_long};
use std::marker::PhantomData;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use libloading::Library;

use super::error::VmrError;
use super::ffi::*;
use super::params::script;

/// `Login` may run once per process, ever. Reconnects poll instead.
static LOGIN_CALLED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginStatus {
    /// Voicemeeter is running and answered.
    Running,
    /// Logged in, but Voicemeeter isn't running yet. Poll `is_dirty()` until it is.
    NotRunning,
}

/// `VBVMR_RunVoicemeeter` targets (header values).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunKind {
    Voicemeeter = 1,
    Banana = 2,
    Potato = 3,
    VoicemeeterX64 = 4,
    BananaX64 = 5,
    PotatoX64 = 6,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VmType {
    Basic,
    Banana,
    Potato,
}

impl VmType {
    pub const fn name(self) -> &'static str {
        match self {
            VmType::Basic => "Voicemeeter",
            VmType::Banana => "Voicemeeter Banana",
            VmType::Potato => "Voicemeeter Potato",
        }
    }
}

/// `VBVMR_GetLevel` `nType`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LevelKind {
    PreFader = 0,
    PostFader = 1,
    PostMute = 2,
    Output = 3,
}

/// Audio driver type from device enumeration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceKind {
    Mme,
    Wdm,
    Ks,
    Asio,
    Other(i32),
}

impl DeviceKind {
    pub const fn from_code(code: i32) -> Self {
        match code {
            1 => DeviceKind::Mme,
            3 => DeviceKind::Wdm,
            4 => DeviceKind::Ks,
            5 => DeviceKind::Asio,
            c => DeviceKind::Other(c),
        }
    }

    /// The write-only selector param for this driver type (`device.wdm` …).
    pub const fn param(self) -> Option<super::params::DeviceParam> {
        use super::params::DeviceParam;
        match self {
            DeviceKind::Mme => Some(DeviceParam::Mme),
            DeviceKind::Wdm => Some(DeviceParam::Wdm),
            DeviceKind::Ks => Some(DeviceParam::Ks),
            DeviceKind::Asio => Some(DeviceParam::Asio),
            DeviceKind::Other(_) => None,
        }
    }

    pub const fn label(self) -> &'static str {
        match self {
            DeviceKind::Mme => "MME",
            DeviceKind::Wdm => "WDM",
            DeviceKind::Ks => "KS",
            DeviceKind::Asio => "ASIO",
            DeviceKind::Other(_) => "?",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceDesc {
    pub kind: DeviceKind,
    pub name: String,
    pub hwid: String,
}

/// Resolved entry points. Plain fn pointers, valid while `VmrClient::_lib` is alive.
struct Api {
    login: FnLogin,
    logout: FnLogout,
    run_voicemeeter: FnRunVoicemeeter,
    get_type: FnGetVoicemeeterType,
    get_version: FnGetVoicemeeterVersion,
    is_dirty: FnIsParametersDirty,
    get_float: FnGetParameterFloat,
    get_string_w: FnGetParameterStringW,
    get_level: FnGetLevel,
    set_float: FnSetParameterFloat,
    set_string_w: FnSetParameterStringW,
    set_parameters: FnSetParameters,
    input_count: FnGetDeviceNumber,
    input_desc_w: FnGetDeviceDescW,
    output_count: FnGetDeviceNumber,
    output_desc_w: FnGetDeviceDescW,
    // Optional (newer or not needed for core features).
    set_parameters_w: Option<FnSetParametersW>,
    set_custom_button: Option<FnSetCustomButton>,
}

/// Safe wrapper over `VoicemeeterRemote64.dll`. Logs out on drop.
pub struct VmrClient {
    api: Api,
    path: PathBuf,
    logged_in: bool,
    /// `!Sync`: all calls must come from the thread that owns the client.
    _not_sync: PhantomData<Cell<()>>,
    /// Dropped last, after `Drop::drop` has logged out.
    _lib: Library,
}

impl std::fmt::Debug for VmrClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VmrClient")
            .field("path", &self.path)
            .field("logged_in", &self.logged_in)
            .finish()
    }
}

/// Copies a fn pointer of type `T` out of the library.
///
/// # Safety
/// `T` must be the exact fn-pointer type of the export `name`.
unsafe fn sym<T: Copy>(lib: &Library, name: &'static str) -> Option<T> {
    // SAFETY: forwarded to the caller; the pointer is copied out and stays valid while `lib` lives.
    unsafe { lib.get::<T>(name).ok().map(|s| *s) }
}

/// # Safety
/// As for [`sym`].
unsafe fn req<T: Copy>(lib: &Library, name: &'static str) -> Result<T, VmrError> {
    // SAFETY: forwarded to the caller.
    unsafe { sym(lib, name) }.ok_or(VmrError::MissingSymbol(name))
}

impl VmrClient {
    /// Loads the DLL and resolves every required symbol up front. Optional ones become `None`.
    pub fn load(path: &Path) -> Result<Self, VmrError> {
        if !path.is_file() {
            return Err(VmrError::DllNotFound {
                searched: vec![path.to_path_buf()],
            });
        }
        // SAFETY: loading the user's installed Voicemeeter Remote DLL by absolute path; its
        // initialisers are the vendor's and have no extra requirements.
        let lib = unsafe { Library::new(path) }.map_err(|e| VmrError::Load(e.to_string()))?;
        // SAFETY: each type below is transcribed from VoicemeeterRemote.h for that export.
        let api = unsafe {
            Api {
                login: req(&lib, "VBVMR_Login")?,
                logout: req(&lib, "VBVMR_Logout")?,
                run_voicemeeter: req(&lib, "VBVMR_RunVoicemeeter")?,
                get_type: req(&lib, "VBVMR_GetVoicemeeterType")?,
                get_version: req(&lib, "VBVMR_GetVoicemeeterVersion")?,
                is_dirty: req(&lib, "VBVMR_IsParametersDirty")?,
                get_float: req(&lib, "VBVMR_GetParameterFloat")?,
                get_string_w: req(&lib, "VBVMR_GetParameterStringW")?,
                get_level: req(&lib, "VBVMR_GetLevel")?,
                set_float: req(&lib, "VBVMR_SetParameterFloat")?,
                set_string_w: req(&lib, "VBVMR_SetParameterStringW")?,
                set_parameters: req(&lib, "VBVMR_SetParameters")?,
                input_count: req(&lib, "VBVMR_Input_GetDeviceNumber")?,
                input_desc_w: req(&lib, "VBVMR_Input_GetDeviceDescW")?,
                output_count: req(&lib, "VBVMR_Output_GetDeviceNumber")?,
                output_desc_w: req(&lib, "VBVMR_Output_GetDeviceDescW")?,
                set_parameters_w: sym(&lib, "VBVMR_SetParametersW"),
                set_custom_button: sym(&lib, "VBVMR_SetCustomButton"),
            }
        };
        Ok(Self {
            api,
            path: path.to_path_buf(),
            logged_in: false,
            _not_sync: PhantomData,
            _lib: lib,
        })
    }

    /// Path the DLL was loaded from.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Which optional exports this DLL has, as `(name, present)`.
    pub fn optional_symbols(&self) -> [(&'static str, bool); 2] {
        [
            ("VBVMR_SetParametersW", self.api.set_parameters_w.is_some()),
            (
                "VBVMR_SetCustomButton",
                self.api.set_custom_button.is_some(),
            ),
        ]
    }

    pub fn is_logged_in(&self) -> bool {
        self.logged_in
    }

    /// Opens the communication pipe. **Once per process**: a second call (even after
    /// `logout`, even on another client) returns `InvalidInput` without touching the DLL.
    pub fn login(&mut self) -> Result<LoginStatus, VmrError> {
        if LOGIN_CALLED.swap(true, Ordering::SeqCst) {
            return Err(VmrError::InvalidInput(
                "Login was already called in this process; poll is_dirty() instead of logging in again".into(),
            ));
        }
        // SAFETY: no arguments.
        let rc = unsafe { (self.api.login)() };
        match rc {
            0 => {
                self.logged_in = true;
                Ok(LoginStatus::Running)
            }
            1 => {
                self.logged_in = true;
                Ok(LoginStatus::NotRunning)
            }
            code => Err(VmrError::Code {
                func: "VBVMR_Login",
                code,
            }),
        }
    }

    /// Closes the pipe. Idempotent; also runs on drop.
    pub fn logout(&mut self) {
        if self.logged_in {
            // SAFETY: no arguments; only called after a successful login.
            let _ = unsafe { (self.api.logout)() };
            self.logged_in = false;
        }
    }

    pub fn run_voicemeeter(&self, kind: RunKind) -> Result<(), VmrError> {
        // SAFETY: plain integer argument.
        let rc = unsafe { (self.api.run_voicemeeter)(kind as c_long) };
        match rc {
            0 => Ok(()),
            code => Err(VmrError::Code {
                func: "VBVMR_RunVoicemeeter",
                code,
            }),
        }
    }

    pub fn vm_type(&self) -> Result<VmType, VmrError> {
        let mut t: c_long = 0;
        // SAFETY: `t` is a valid out-pointer for the call's duration.
        let rc = unsafe { (self.api.get_type)(&mut t) };
        check("VBVMR_GetVoicemeeterType", rc)?;
        match t {
            1 => Ok(VmType::Basic),
            2 => Ok(VmType::Banana),
            3 => Ok(VmType::Potato),
            code => Err(VmrError::Code {
                func: "VBVMR_GetVoicemeeterType",
                code,
            }),
        }
    }

    /// Version as `[v1, v2, v3, v4]`, e.g. `[3, 1, 3, 0]`.
    pub fn vm_version_parts(&self) -> Result<[u8; 4], VmrError> {
        let mut v: c_long = 0;
        // SAFETY: `v` is a valid out-pointer for the call's duration.
        let rc = unsafe { (self.api.get_version)(&mut v) };
        check("VBVMR_GetVoicemeeterVersion", rc)?;
        Ok(split_version(v))
    }

    /// Version string, e.g. `"3.1.3.0"`.
    pub fn vm_version(&self) -> Result<String, VmrError> {
        self.vm_version_parts().map(format_version)
    }

    /// `true` when parameters changed since the last call. Any negative return means
    /// Voicemeeter is gone and maps to `Err(NoServer)`.
    pub fn is_dirty(&self) -> Result<bool, VmrError> {
        // SAFETY: no arguments.
        let rc = unsafe { (self.api.is_dirty)() };
        if rc < 0 {
            Err(VmrError::NoServer)
        } else {
            Ok(rc != 0)
        }
    }

    pub fn get_float(&self, name: &str) -> Result<f32, VmrError> {
        let c = c_name(name)?;
        let mut v: f32 = 0.0;
        // SAFETY: `c` is NUL-terminated and `v` a valid out-pointer for the call.
        let rc = unsafe { (self.api.get_float)(c.as_ptr(), &mut v) };
        check_param("VBVMR_GetParameterFloat", name, rc)?;
        Ok(v)
    }

    /// Reads a string parameter through the W (UTF-16) variant, 512-wchar buffer.
    pub fn get_string(&self, name: &str) -> Result<String, VmrError> {
        let c = c_name(name)?;
        let mut buf = [0u16; STRING_BUF_LEN];
        // SAFETY: `buf` has the 512 wide chars the SDK requires; `c` is NUL-terminated.
        let rc = unsafe { (self.api.get_string_w)(c.as_ptr(), buf.as_mut_ptr()) };
        check_param("VBVMR_GetParameterStringW", name, rc)?;
        Ok(from_wide(&buf))
    }

    pub fn set_float(&self, name: &str, v: f32) -> Result<(), VmrError> {
        if !v.is_finite() {
            return Err(VmrError::InvalidInput(format!(
                "{name}: value {v} is not a finite number"
            )));
        }
        let c = c_name(name)?;
        // SAFETY: `c` is NUL-terminated.
        let rc = unsafe { (self.api.set_float)(c.as_ptr(), v) };
        check_param("VBVMR_SetParameterFloat", name, rc)
    }

    /// Writes a string parameter through the W variant (any Unicode, no quoting needed).
    pub fn set_string(&self, name: &str, v: &str) -> Result<(), VmrError> {
        let c = c_name(name)?;
        let w = to_wide(v).ok_or_else(|| {
            VmrError::InvalidInput(format!("{name}: value contains a NUL character"))
        })?;
        // SAFETY: both buffers are NUL-terminated and outlive the call.
        let rc = unsafe { (self.api.set_string_w)(c.as_ptr(), w.as_ptr()) };
        check_param("VBVMR_SetParameterStringW", name, rc)
    }

    /// Applies a script atomically. ASCII scripts use `SetParameters`; scripts with other
    /// characters use `SetParametersW` (when the DLL has it). `> 0` → `Err(ScriptLine(n))`.
    pub fn set_script(&self, script_text: &str) -> Result<(), VmrError> {
        if script_text.len() > script::MAX_BYTES {
            return Err(VmrError::InvalidInput(format!(
                "script is {} bytes; the limit is {} (use params::script::Builder::chunks)",
                script_text.len(),
                script::MAX_BYTES
            )));
        }
        let (func, rc) = if script_text.is_ascii() {
            let c = CString::new(script_text)
                .map_err(|_| VmrError::InvalidInput("script contains a NUL character".into()))?;
            // SAFETY: `c` is NUL-terminated and outlives the call.
            ("VBVMR_SetParameters", unsafe {
                (self.api.set_parameters)(c.as_ptr())
            })
        } else {
            let f = self.api.set_parameters_w.ok_or_else(|| {
                VmrError::InvalidInput(
                    "this DLL has no VBVMR_SetParametersW; scripts must be ASCII".into(),
                )
            })?;
            let w = to_wide(script_text)
                .ok_or_else(|| VmrError::InvalidInput("script contains a NUL character".into()))?;
            // SAFETY: `w` is NUL-terminated UTF-16 and outlives the call.
            ("VBVMR_SetParametersW", unsafe { f(w.as_ptr()) })
        };
        match rc {
            0 => Ok(()),
            n if n > 0 => Err(VmrError::ScriptLine(n)),
            -2 => Err(VmrError::NoServer),
            code => Err(VmrError::Code { func, code }),
        }
    }

    /// One linear level sample (1.0 = 0 dBFS). See `layout` for channel ranges.
    pub fn get_level(&self, kind: LevelKind, channel: u32) -> Result<f32, VmrError> {
        let ch = c_long::try_from(channel).map_err(|_| {
            VmrError::InvalidInput(format!("level channel {channel} is out of range"))
        })?;
        let mut v: f32 = 0.0;
        // SAFETY: `v` is a valid out-pointer for the call.
        let rc = unsafe { (self.api.get_level)(kind as c_long, ch, &mut v) };
        check("VBVMR_GetLevel", rc)?;
        Ok(v)
    }

    pub fn input_devices(&self) -> Result<Vec<DeviceDesc>, VmrError> {
        self.devices(
            "VBVMR_Input_GetDeviceDescW",
            self.api.input_count,
            self.api.input_desc_w,
        )
    }

    pub fn output_devices(&self) -> Result<Vec<DeviceDesc>, VmrError> {
        self.devices(
            "VBVMR_Output_GetDeviceDescW",
            self.api.output_count,
            self.api.output_desc_w,
        )
    }

    fn devices(
        &self,
        func: &'static str,
        count: FnGetDeviceNumber,
        desc: FnGetDeviceDescW,
    ) -> Result<Vec<DeviceDesc>, VmrError> {
        // SAFETY: no arguments.
        let n = unsafe { count() };
        if n < 0 {
            return Err(if n == -2 {
                VmrError::NoServer
            } else {
                VmrError::Code { func, code: n }
            });
        }
        let mut out = Vec::with_capacity(n as usize);
        for i in 0..n {
            let mut kind: c_long = 0;
            let mut name = [0u16; DEVICE_BUF_LEN];
            let mut hwid = [0u16; DEVICE_BUF_LEN];
            // SAFETY: buffers exceed the header's "256 char min"; all pointers valid for the call.
            let rc = unsafe { desc(i, &mut kind, name.as_mut_ptr(), hwid.as_mut_ptr()) };
            check(func, rc)?;
            out.push(DeviceDesc {
                kind: DeviceKind::from_code(kind),
                name: from_wide(&name),
                hwid: from_wide(&hwid),
            });
        }
        Ok(out)
    }
}

impl Drop for VmrClient {
    fn drop(&mut self) {
        self.logout();
    }
}

fn check(func: &'static str, rc: c_long) -> Result<(), VmrError> {
    match rc {
        0 => Ok(()),
        -2 => Err(VmrError::NoServer),
        code => Err(VmrError::Code { func, code }),
    }
}

fn check_param(func: &'static str, name: &str, rc: c_long) -> Result<(), VmrError> {
    match rc {
        -3 => Err(VmrError::UnknownParam(name.to_string())),
        rc => check(func, rc),
    }
}

/// Parameter names go to the DLL as `char*`: ASCII only, no NUL.
pub(crate) fn c_name(name: &str) -> Result<CString, VmrError> {
    if name.is_empty() || !name.is_ascii() {
        return Err(VmrError::InvalidInput(format!(
            "parameter name `{name}` must be non-empty ASCII"
        )));
    }
    CString::new(name)
        .map_err(|_| VmrError::InvalidInput("parameter name contains a NUL character".into()))
}

/// UTF-16 + terminating NUL. `None` if `s` has an interior NUL.
pub(crate) fn to_wide(s: &str) -> Option<Vec<u16>> {
    if s.contains('\0') {
        return None;
    }
    Some(s.encode_utf16().chain(std::iter::once(0)).collect())
}

/// Up to the first NUL (or the whole buffer if unterminated).
pub(crate) fn from_wide(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

pub(crate) fn split_version(v: c_long) -> [u8; 4] {
    let v = v as u32;
    [(v >> 24) as u8, (v >> 16) as u8, (v >> 8) as u8, v as u8]
}

pub fn format_version(p: [u8; 4]) -> String {
    format!("{}.{}.{}.{}", p[0], p[1], p[2], p[3])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_split() {
        let v = (3 << 24 | 1 << 16 | 3 << 8) as c_long;
        assert_eq!(split_version(v), [3, 1, 3, 0]);
        assert_eq!(format_version(split_version(v)), "3.1.3.0");
        assert_eq!(split_version(-1), [255, 255, 255, 255]);
    }

    #[test]
    fn wide_roundtrip() {
        let w = to_wide("Mic ü 🎙").expect("no NUL");
        assert_eq!(*w.last().expect("terminated"), 0);
        assert_eq!(from_wide(&w), "Mic ü 🎙");
        assert_eq!(to_wide("a\0b"), None);
        let mut buf = [0u16; 8];
        buf[..2].copy_from_slice(&[b'h' as u16, b'i' as u16]);
        assert_eq!(from_wide(&buf), "hi");
        assert_eq!(from_wide(&[b'x' as u16; 3]), "xxx");
    }

    #[test]
    fn param_names_validated() {
        assert!(c_name("Strip[0].Gain").is_ok());
        assert!(matches!(c_name(""), Err(VmrError::InvalidInput(_))));
        assert!(matches!(
            c_name("Strip[0].Gäin"),
            Err(VmrError::InvalidInput(_))
        ));
        assert!(matches!(c_name("a\0b"), Err(VmrError::InvalidInput(_))));
    }

    #[test]
    fn return_codes() {
        assert_eq!(check("VBVMR_GetLevel", 0), Ok(()));
        assert_eq!(check("VBVMR_GetLevel", -2), Err(VmrError::NoServer));
        assert_eq!(
            check("VBVMR_GetLevel", -4),
            Err(VmrError::Code {
                func: "VBVMR_GetLevel",
                code: -4
            })
        );
        assert_eq!(
            check_param("f", "X.Y", -3),
            Err(VmrError::UnknownParam("X.Y".into()))
        );
        assert_eq!(check_param("f", "X.Y", -2), Err(VmrError::NoServer));
    }

    #[test]
    fn device_kinds() {
        assert_eq!(DeviceKind::from_code(3), DeviceKind::Wdm);
        assert_eq!(DeviceKind::from_code(5).label(), "ASIO");
        assert_eq!(DeviceKind::from_code(9), DeviceKind::Other(9));
        assert_eq!(DeviceKind::Other(9).param(), None);
    }

    #[test]
    fn load_missing_file_lists_path() {
        let p = Path::new(r"Z:\definitely\not\here\VoicemeeterRemote64.dll");
        match VmrClient::load(p) {
            Err(VmrError::DllNotFound { searched }) => assert_eq!(searched, vec![p.to_path_buf()]),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn client_is_send() {
        fn assert_send<T: Send>() {}
        assert_send::<VmrClient>();
    }
}
