//! Raw function-pointer types for `VoicemeeterRemote64.dll`, transcribed from
//! `docs/reference/VoicemeeterRemote.h`. `long` is 32-bit on Windows, `__stdcall` is
//! `extern "system"`, `unsigned short*` strings are UTF-16.

use std::ffi::{c_char, c_float, c_long, c_ushort, c_void};

pub type FnLogin = unsafe extern "system" fn() -> c_long;
pub type FnLogout = unsafe extern "system" fn() -> c_long;
pub type FnRunVoicemeeter = unsafe extern "system" fn(v_type: c_long) -> c_long;
pub type FnGetVoicemeeterType = unsafe extern "system" fn(p_type: *mut c_long) -> c_long;
pub type FnGetVoicemeeterVersion = unsafe extern "system" fn(p_version: *mut c_long) -> c_long;
pub type FnIsParametersDirty = unsafe extern "system" fn() -> c_long;
pub type FnGetParameterFloat =
    unsafe extern "system" fn(name: *const c_char, value: *mut c_float) -> c_long;
pub type FnGetParameterStringW =
    unsafe extern "system" fn(name: *const c_char, wstr: *mut c_ushort) -> c_long;
pub type FnGetLevel =
    unsafe extern "system" fn(n_type: c_long, channel: c_long, value: *mut c_float) -> c_long;
pub type FnSetParameterFloat =
    unsafe extern "system" fn(name: *const c_char, value: c_float) -> c_long;
pub type FnSetParameterStringW =
    unsafe extern "system" fn(name: *const c_char, wstr: *const c_ushort) -> c_long;
pub type FnSetParameters = unsafe extern "system" fn(script: *const c_char) -> c_long;
pub type FnSetParametersW = unsafe extern "system" fn(script: *const c_ushort) -> c_long;
pub type FnGetDeviceNumber = unsafe extern "system" fn() -> c_long;
pub type FnGetDeviceDescW = unsafe extern "system" fn(
    index: c_long,
    n_type: *mut c_long,
    name: *mut c_ushort,
    hwid: *mut c_ushort,
) -> c_long;
/// `VBVMR_SetCustomButton` (3.1.2.9+). Resolved as optional; not wrapped yet.
pub type FnSetCustomButton = unsafe extern "system" fn(
    zindex: c_long,
    b_type: c_long,
    b_state: c_long,
    label: *const c_ushort,
    hwnd: *mut c_void,
    id_command: c_long,
) -> c_long;

/// `GetParameterStringW` buffer: 512 wide chars (header: "512 char or wchar").
pub const STRING_BUF_LEN: usize = 512;
/// Device name / hardware-id buffers: header says "256 char min"; we give 512.
pub const DEVICE_BUF_LEN: usize = 512;

/// Exports the wrapper requires. A missing one fails `VmrClient::load`.
pub const REQUIRED: &[&str] = &[
    "VBVMR_Login",
    "VBVMR_Logout",
    "VBVMR_RunVoicemeeter",
    "VBVMR_GetVoicemeeterType",
    "VBVMR_GetVoicemeeterVersion",
    "VBVMR_IsParametersDirty",
    "VBVMR_GetParameterFloat",
    "VBVMR_GetParameterStringW",
    "VBVMR_GetLevel",
    "VBVMR_SetParameterFloat",
    "VBVMR_SetParameterStringW",
    "VBVMR_SetParameters",
    "VBVMR_Input_GetDeviceNumber",
    "VBVMR_Input_GetDeviceDescW",
    "VBVMR_Output_GetDeviceNumber",
    "VBVMR_Output_GetDeviceDescW",
];

/// Exports resolved if present (`Option<fn>`); never a load failure.
pub const OPTIONAL: &[&str] = &["VBVMR_SetParametersW", "VBVMR_SetCustomButton"];

/// Every public function declared in `VoicemeeterRemote.h` (the version in docs/reference).
/// Used by the probe's version check to diff against the DLL's real export table.
pub const HEADER_EXPORTS: &[&str] = &[
    "VBVMR_Login",
    "VBVMR_Logout",
    "VBVMR_RunVoicemeeter",
    "VBVMR_GetVoicemeeterType",
    "VBVMR_GetVoicemeeterVersion",
    "VBVMR_IsParametersDirty",
    "VBVMR_GetParameterFloat",
    "VBVMR_GetParameterStringA",
    "VBVMR_GetParameterStringW",
    "VBVMR_GetLevel",
    "VBVMR_GetMidiMessage",
    "VBVMR_SendMidiMessage",
    "VBVMR_SetParameterFloat",
    "VBVMR_SetParameterStringA",
    "VBVMR_SetParameterStringW",
    "VBVMR_SetParameters",
    "VBVMR_SetParametersW",
    "VBVMR_Output_GetDeviceNumber",
    "VBVMR_Output_GetDeviceDescA",
    "VBVMR_Output_GetDeviceDescW",
    "VBVMR_Input_GetDeviceNumber",
    "VBVMR_Input_GetDeviceDescA",
    "VBVMR_Input_GetDeviceDescW",
    "VBVMR_AudioCallbackRegister",
    "VBVMR_AudioCallbackStart",
    "VBVMR_AudioCallbackStop",
    "VBVMR_AudioCallbackUnregister",
    "VBVMR_MacroButton_IsDirty",
    "VBVMR_MacroButton_GetStatus",
    "VBVMR_MacroButton_SetStatus",
    "VBVMR_SetCustomButton",
];

/// Declared in the header under `#ifdef VBUSE_LOCALLIB` ("internal used, not public").
/// Its presence in the DLL is expected and not a discrepancy.
pub const HEADER_INTERNAL: &[&str] = &["VBVMR_SetHinstance"];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn required_and_optional_are_in_header() {
        for name in REQUIRED.iter().chain(OPTIONAL) {
            assert!(HEADER_EXPORTS.contains(name), "{name} not in header list");
        }
        assert_eq!(HEADER_EXPORTS.len(), 31);
    }
}
