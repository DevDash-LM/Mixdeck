//! Typed errors for the Remote API wrapper. Every DLL return code maps to one of these,
//! with a message a human can act on.

use std::path::PathBuf;

/// Errors from locating, loading or calling `VoicemeeterRemote64.dll`.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum VmrError {
    /// The DLL wasn't found in the registry location or the fallback folder.
    #[error("VoicemeeterRemote64.dll was not found. Is Voicemeeter installed? Searched: {}", list_paths(.searched))]
    DllNotFound { searched: Vec<PathBuf> },

    /// The DLL exists but Windows couldn't load it, or a file couldn't be read.
    #[error("Could not load the Voicemeeter Remote DLL: {0}")]
    Load(String),

    /// A required export is missing from the DLL (it is too old or not the real DLL).
    #[error("The Voicemeeter Remote DLL has no `{0}` export. Update Voicemeeter.")]
    MissingSymbol(&'static str),

    /// Voicemeeter isn't running (or went away). The engine polls until it's back.
    #[error("Voicemeeter is not running")]
    NoServer,

    /// Voicemeeter doesn't know this parameter name.
    #[error("Voicemeeter does not know the parameter `{0}`")]
    UnknownParam(String),

    /// `SetParameters` rejected the script at this (1-based) line.
    #[error("Voicemeeter rejected script line {0}")]
    ScriptLine(i32),

    /// The caller passed something the DLL can't take (NUL byte, non-ASCII name, script
    /// over 48 kB, a second Login). Nothing was sent to Voicemeeter.
    #[error("Invalid request: {0}")]
    InvalidInput(String),

    /// Any other non-success return code.
    #[error("{func} failed: {} (code {code})", describe(.func, *.code))]
    Code { func: &'static str, code: i32 },
}

fn list_paths(paths: &[PathBuf]) -> String {
    if paths.is_empty() {
        return "(nothing)".into();
    }
    paths
        .iter()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join("; ")
}

/// Human meaning of a return code, per function, from `VoicemeeterRemote.h`.
pub fn describe(func: &str, code: i32) -> &'static str {
    let short = func.strip_prefix("VBVMR_").unwrap_or(func);
    match (short, code) {
        ("Login", -1) => "cannot get a client (unexpected)",
        ("Login", -2) => "already logged in (Logout was expected first)",
        ("RunVoicemeeter", -1) => {
            "Voicemeeter is not installed (no UninstallString in the registry)"
        }
        ("RunVoicemeeter", -2) => "unknown Voicemeeter type number",
        ("GetLevel", -3) => "no level available",
        ("GetLevel", -4) => "level channel out of range",
        ("SetParameters" | "SetParametersW", -3 | -4) => "unexpected script error",
        (_, -1) => "unexpected error",
        (_, -2) => "Voicemeeter is not running",
        (_, -3) => "unknown parameter",
        (_, -5) => "structure mismatch (DLL and Voicemeeter versions differ)",
        _ => "unexpected return code",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_are_human() {
        let e = VmrError::Code {
            func: "VBVMR_RunVoicemeeter",
            code: -1,
        };
        assert_eq!(
            e.to_string(),
            "VBVMR_RunVoicemeeter failed: Voicemeeter is not installed (no UninstallString in the registry) (code -1)"
        );
        let e = VmrError::Code {
            func: "VBVMR_GetParameterFloat",
            code: -5,
        };
        assert!(e.to_string().contains("structure mismatch"));
        let e = VmrError::DllNotFound {
            searched: vec![PathBuf::from(r"C:\a"), PathBuf::from(r"C:\b")],
        };
        assert!(e.to_string().ends_with(r"Searched: C:\a; C:\b"));
        assert_eq!(
            VmrError::ScriptLine(3).to_string(),
            "Voicemeeter rejected script line 3"
        );
    }

    #[test]
    fn describe_falls_back() {
        assert_eq!(describe("VBVMR_GetLevel", -4), "level channel out of range");
        assert_eq!(describe("VBVMR_Foo", -2), "Voicemeeter is not running");
        assert_eq!(describe("VBVMR_Foo", -99), "unexpected return code");
    }
}
