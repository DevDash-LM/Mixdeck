//! `VmBackend`: the `VmrClient` methods the engine uses, so the engine runs the same against
//! the real DLL (`RealBackend`) and the simulator (`FakeBackend`).
//!
//! Backends are created and used only on the engine's worker thread.

use std::path::Path;

use crate::vmr::{DeviceDesc, LevelKind, LoginStatus, RunKind, VmType, VmrClient, VmrError};

use super::fake::FakeBackend;
use super::state::BackendKind;

pub trait VmBackend {
    fn kind(&self) -> BackendKind;
    fn vm_type(&self) -> Result<VmType, VmrError>;
    fn vm_version(&self) -> Result<String, VmrError>;
    fn vm_version_parts(&self) -> Result<[u8; 4], VmrError>;
    /// True when parameters changed since the last call. `Err(NoServer)` = Voicemeeter gone.
    fn is_dirty(&mut self) -> Result<bool, VmrError>;
    fn get_float(&self, name: &str) -> Result<f32, VmrError>;
    fn get_string(&self, name: &str) -> Result<String, VmrError>;
    fn set_float(&mut self, name: &str, v: f32) -> Result<(), VmrError>;
    fn set_string(&mut self, name: &str, v: &str) -> Result<(), VmrError>;
    fn set_script(&mut self, script: &str) -> Result<(), VmrError>;
    /// Linear level. Callers treat any error other than `NoServer` as silence.
    fn get_level(&self, kind: LevelKind, channel: u32) -> Result<f32, VmrError>;
    fn input_devices(&self) -> Result<Vec<DeviceDesc>, VmrError>;
    fn output_devices(&self) -> Result<Vec<DeviceDesc>, VmrError>;
    fn run_voicemeeter(&mut self, kind: RunKind) -> Result<(), VmrError>;
    /// Path of the loaded DLL (real backend only).
    fn dll_path(&self) -> Option<&Path> {
        None
    }
    /// Demo-mode hooks; `Some` only for `FakeBackend`.
    fn as_fake_mut(&mut self) -> Option<&mut FakeBackend> {
        None
    }
}

/// The real DLL. Owns the client; dropping it logs out.
pub struct RealBackend {
    client: VmrClient,
}

impl RealBackend {
    /// Loads the DLL at `path` and logs in (once per process; see `VmrClient::login`).
    /// On a login error the loaded-but-not-logged-in backend is returned with the error, so
    /// the caller can still report its path.
    pub fn open(path: &Path) -> Result<(Self, LoginStatus), OpenError> {
        let mut client = VmrClient::load(path).map_err(OpenError::Load)?;
        match client.login() {
            Ok(status) => Ok((Self { client }, status)),
            Err(e) => Err(OpenError::Login(e)),
        }
    }
}

#[derive(Debug)]
pub enum OpenError {
    Load(VmrError),
    Login(VmrError),
}

impl VmBackend for RealBackend {
    fn kind(&self) -> BackendKind {
        BackendKind::Real
    }
    fn vm_type(&self) -> Result<VmType, VmrError> {
        self.client.vm_type()
    }
    fn vm_version(&self) -> Result<String, VmrError> {
        self.client.vm_version()
    }
    fn vm_version_parts(&self) -> Result<[u8; 4], VmrError> {
        self.client.vm_version_parts()
    }
    fn is_dirty(&mut self) -> Result<bool, VmrError> {
        self.client.is_dirty()
    }
    fn get_float(&self, name: &str) -> Result<f32, VmrError> {
        self.client.get_float(name)
    }
    fn get_string(&self, name: &str) -> Result<String, VmrError> {
        self.client.get_string(name)
    }
    fn set_float(&mut self, name: &str, v: f32) -> Result<(), VmrError> {
        self.client.set_float(name, v)
    }
    fn set_string(&mut self, name: &str, v: &str) -> Result<(), VmrError> {
        self.client.set_string(name, v)
    }
    fn set_script(&mut self, script: &str) -> Result<(), VmrError> {
        self.client.set_script(script)
    }
    fn get_level(&self, kind: LevelKind, channel: u32) -> Result<f32, VmrError> {
        self.client.get_level(kind, channel)
    }
    fn input_devices(&self) -> Result<Vec<DeviceDesc>, VmrError> {
        self.client.input_devices()
    }
    fn output_devices(&self) -> Result<Vec<DeviceDesc>, VmrError> {
        self.client.output_devices()
    }
    fn run_voicemeeter(&mut self, kind: RunKind) -> Result<(), VmrError> {
        self.client.run_voicemeeter(kind)
    }
    fn dll_path(&self) -> Option<&Path> {
        Some(self.client.path())
    }
}
