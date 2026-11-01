//! The real backend: Windows Core Audio (WASAPI session API) plus process names and icons.
//! Every object here is created and used on the sessions COM thread (MTA); nothing is `Send`.
//! We only *call* COM, never implement interfaces, so no Rust code runs inside a COM callback.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use windows::Win32::Devices::FunctionDiscovery::{
    PKEY_Device_DeviceDesc, PKEY_Device_FriendlyName, PKEY_DeviceInterface_FriendlyName,
};
use windows::Win32::Foundation::{CloseHandle, PROPERTYKEY, S_OK};
use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
use windows::Win32::Media::Audio::{
    AudioSessionStateActive, AudioSessionStateExpired, DEVICE_STATE, DEVICE_STATE_ACTIVE,
    DEVICE_STATEMASK_ALL, EDataFlow, IAudioSessionControl2, IAudioSessionManager2, IMMDevice,
    IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator, eAll, eCapture, eRender,
};
use windows::Win32::Storage::FileSystem::{
    GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
};
use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PropVariantToStringAlloc};
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
    CoUninitialize, STGM_READ,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::core::{GUID, HSTRING, Interface, PWSTR};

use super::SessionsError;
use super::icons::IconCache;
use super::mapping::{EndpointInfo, EndpointState, Flow, Mapping, endpoint_name};
use super::types::{AppSession, EndpointApps, session_key};
use super::worker::{ScanOptions, SessionsBackend};

fn com(context: &'static str) -> impl FnOnce(windows::core::Error) -> SessionsError {
    move |source| SessionsError::Com { context, source }
}

/// COM for the current thread (MTA). Uninitialises on drop if it initialised.
pub struct ComGuard {
    owned: bool,
}

impl ComGuard {
    pub fn init_mta() -> Result<Self, SessionsError> {
        // SAFETY: plain COM init for this thread; balanced in Drop.
        let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if hr.is_ok() {
            Ok(Self { owned: true })
        } else {
            Err(SessionsError::Com {
                context: "CoInitializeEx",
                source: hr.into(),
            })
        }
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.owned {
            // SAFETY: balances the successful CoInitializeEx above, on the same thread.
            unsafe { CoUninitialize() };
        }
    }
}

/// Copies and frees a COM-allocated string.
fn take_pwstr(p: PWSTR) -> String {
    if p.is_null() {
        return String::new();
    }
    // SAFETY: `p` is a NUL-terminated string allocated with CoTaskMemAlloc by the callee.
    let s = unsafe { p.to_string() }.unwrap_or_default();
    unsafe { CoTaskMemFree(Some(p.0 as *const _)) };
    s
}

fn read_prop(
    store: &windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore,
    key: &PROPERTYKEY,
) -> String {
    // SAFETY: valid store and key; the PROPVARIANT is cleared after use.
    unsafe {
        let Ok(mut pv) = store.GetValue(key) else {
            return String::new();
        };
        let s = PropVariantToStringAlloc(&pv)
            .map(take_pwstr)
            .unwrap_or_default();
        let _ = PropVariantClear(&mut pv);
        s
    }
}

/// A session we can act on later by key.
struct Live {
    volume: ISimpleAudioVolume,
    meter: Option<IAudioMeterInformation>,
}

/// Name/exe of a process, cached per pid between scans.
#[derive(Clone, Default)]
struct ProcInfo {
    exe: Option<PathBuf>,
    description: Option<String>,
    /// Mixdeck itself (or its WebView2 children) or Voicemeeter: never listed as an app.
    hidden: bool,
}

pub struct CoreAudio {
    enumerator: IMMDeviceEnumerator,
    live: HashMap<String, Live>,
    procs: HashMap<u32, ProcInfo>,
    icons: IconCache,
}

/// One raw session as read from Windows (for the probe).
#[derive(Debug, Clone)]
pub struct RawSession {
    pub app: AppSession,
    pub display_name: String,
    pub state: &'static str,
    pub peak: Option<f32>,
}

impl CoreAudio {
    /// COM must already be initialised on this thread (`ComGuard`).
    pub fn new() -> Result<Self, SessionsError> {
        // SAFETY: standard activation of the system endpoint enumerator.
        let enumerator: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
                .map_err(com("create IMMDeviceEnumerator"))?;
        Ok(Self {
            enumerator,
            live: HashMap::new(),
            procs: HashMap::new(),
            icons: IconCache::default(),
        })
    }

    /// Every endpoint in every state (the probe), or only active ones.
    pub fn endpoints(
        &self,
        active_only: bool,
    ) -> Result<Vec<(EndpointInfo, IMMDevice)>, SessionsError> {
        let mask = if active_only {
            DEVICE_STATE_ACTIVE
        } else {
            DEVICE_STATE(DEVICE_STATEMASK_ALL)
        };
        // SAFETY: all calls on live COM objects owned by this thread.
        unsafe {
            let coll = self
                .enumerator
                .EnumAudioEndpoints(eAll, mask)
                .map_err(com("EnumAudioEndpoints"))?;
            let n = coll
                .GetCount()
                .map_err(com("IMMDeviceCollection::GetCount"))?;
            let mut out = Vec::with_capacity(n as usize);
            for i in 0..n {
                let Ok(dev) = coll.Item(i) else { continue };
                let Ok(info) = endpoint_info(&dev) else {
                    continue;
                };
                out.push((info, dev));
            }
            Ok(out)
        }
    }

    /// Probe: sessions on one endpoint, with raw details. Their keys work with `set_mute` etc.
    pub fn probe_sessions(
        &mut self,
        dev: &IMMDevice,
        opts: &ScanOptions,
    ) -> Result<Vec<RawSession>, SessionsError> {
        let mut live = std::mem::take(&mut self.live);
        let r = self.sessions_on(dev, opts, &mut live);
        self.live = live;
        r
    }

    /// Sessions on one endpoint. Remembers handles for `set_*`/peaks under each key in `live`.
    fn sessions_on(
        &mut self,
        dev: &IMMDevice,
        opts: &ScanOptions,
        live: &mut HashMap<String, Live>,
    ) -> Result<Vec<RawSession>, SessionsError> {
        // SAFETY: COM calls on objects owned by this thread; strings freed by take_pwstr.
        unsafe {
            let mgr: IAudioSessionManager2 = dev
                .Activate(CLSCTX_ALL, None)
                .map_err(com("activate IAudioSessionManager2"))?;
            let list = mgr
                .GetSessionEnumerator()
                .map_err(com("GetSessionEnumerator"))?;
            let n = list
                .GetCount()
                .map_err(com("IAudioSessionEnumerator::GetCount"))?;
            let mut out = Vec::new();
            for i in 0..n {
                let Ok(ctl) = list.GetSession(i) else {
                    continue;
                };
                let Ok(ctl2) = ctl.cast::<IAudioSessionControl2>() else {
                    continue;
                };
                let state = ctl2.GetState().unwrap_or(AudioSessionStateExpired);
                if state == AudioSessionStateExpired {
                    continue;
                }
                let system = ctl2.IsSystemSoundsSession() == S_OK;
                if system && !opts.show_system {
                    continue;
                }
                let Ok(volume) = ctl.cast::<ISimpleAudioVolume>() else {
                    continue;
                };
                let instance = ctl2
                    .GetSessionInstanceIdentifier()
                    .map(take_pwstr)
                    .unwrap_or_default();
                if instance.is_empty() {
                    continue;
                }
                let key = session_key(&instance);
                let pid = ctl2.GetProcessId().unwrap_or(0);
                let display_name = ctl2.GetDisplayName().map(take_pwstr).unwrap_or_default();
                let meter = ctl.cast::<IAudioMeterInformation>().ok();
                let peak = meter.as_ref().and_then(|m| m.GetPeakValue().ok());
                let vol = volume.GetMasterVolume().unwrap_or(1.0).clamp(0.0, 1.0);
                let muted = volume.GetMute().map(|b| b.as_bool()).unwrap_or(false);

                let proc = if system {
                    ProcInfo::default()
                } else {
                    self.proc_info(pid)
                };
                if proc.hidden {
                    continue;
                }
                let name = app_name(system, &display_name, &proc, pid);
                let icon = proc.exe.as_deref().and_then(|p| self.icons.get_or_load(p));
                let active = state == AudioSessionStateActive;
                out.push(RawSession {
                    app: AppSession {
                        key: key.clone(),
                        pid,
                        name,
                        exe: proc.exe.as_ref().map(|p| p.to_string_lossy().into_owned()),
                        icon,
                        active,
                        volume: vol,
                        muted,
                        system,
                    },
                    display_name,
                    state: if active { "active" } else { "inactive" },
                    peak,
                });
                live.insert(key, Live { volume, meter });
            }
            Ok(out)
        }
    }

    fn proc_info(&mut self, pid: u32) -> ProcInfo {
        if let Some(p) = self.procs.get(&pid) {
            return p.clone();
        }
        let exe = image_path(pid);
        let description = exe.as_deref().and_then(file_description);
        let hidden =
            is_own_process(pid, exe.as_deref()) || exe.as_deref().is_some_and(is_voicemeeter_exe);
        let info = ProcInfo {
            exe,
            description,
            hidden,
        };
        self.procs.insert(pid, info.clone());
        info
    }

    pub fn icon_cache_len(&self) -> usize {
        self.icons.len()
    }
}

/// Voicemeeter's own executables (voicemeeter*.exe: the engine in every edition, x64 builds,
/// Macro Buttons). Their sessions are the mixer itself, not an app to route.
fn is_voicemeeter_exe(exe: &Path) -> bool {
    exe.file_stem()
        .map(|s| {
            s.to_string_lossy()
                .to_lowercase()
                .starts_with("voicemeeter")
        })
        .unwrap_or(false)
}

/// This process, another Mixdeck instance (same exe), or a child of ours (WebView2 renderers
/// play audio from their own pid).
fn is_own_process(pid: u32, exe: Option<&Path>) -> bool {
    let me = std::process::id();
    if pid == me {
        return true;
    }
    if let (Some(exe), Ok(own)) = (exe, std::env::current_exe())
        && same_path(exe, &own)
    {
        return true;
    }
    descends_from(pid, me)
}

fn same_path(a: &Path, b: &Path) -> bool {
    a.as_os_str()
        .to_string_lossy()
        .eq_ignore_ascii_case(&b.as_os_str().to_string_lossy())
}

/// Walks `pid`'s parent chain (from one process snapshot) looking for `ancestor`.
fn descends_from(pid: u32, ancestor: u32) -> bool {
    let parents = parent_map();
    let mut cur = pid;
    // Bounded: parent pids can be stale/reused and form cycles.
    for _ in 0..16 {
        match parents.get(&cur) {
            Some(&p) if p == ancestor => return true,
            Some(&p) if p != 0 && p != cur => cur = p,
            _ => return false,
        }
    }
    false
}

fn parent_map() -> HashMap<u32, u32> {
    let mut out = HashMap::new();
    // SAFETY: snapshot handle closed below; the entry's dwSize is set before the first call.
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return out;
        };
        let mut e = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snap, &mut e).is_ok() {
            loop {
                out.insert(e.th32ProcessID, e.th32ParentProcessID);
                if Process32NextW(snap, &mut e).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    out
}

/// Name as the Windows volume mixer picks it.
fn app_name(system: bool, display: &str, proc: &ProcInfo, pid: u32) -> String {
    if system {
        return "System sounds".into();
    }
    // "@%SystemRoot%\…,-123" is an unresolved resource reference; skip it.
    let display = display.trim();
    if !display.is_empty() && !display.starts_with('@') {
        return display.into();
    }
    if let Some(d) = proc
        .description
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
    {
        return d.into();
    }
    if let Some(stem) = proc.exe.as_deref().and_then(Path::file_stem) {
        return stem.to_string_lossy().into_owned();
    }
    format!("App (pid {pid})")
}

fn endpoint_info(dev: &IMMDevice) -> windows::core::Result<EndpointInfo> {
    // SAFETY: COM calls on a live device.
    unsafe {
        let id = take_pwstr(dev.GetId()?);
        let state = EndpointState::from_raw(dev.GetState()?.0);
        let flow = match dev
            .cast::<windows::Win32::Media::Audio::IMMEndpoint>()?
            .GetDataFlow()?
        {
            f if f == eCapture => Flow::Capture,
            f if f == eRender => Flow::Render,
            EDataFlow(_) => Flow::Render,
        };
        let (desc, friendly, interface) = match dev.OpenPropertyStore(STGM_READ) {
            Ok(store) => (
                read_prop(&store, &PKEY_Device_DeviceDesc),
                read_prop(&store, &PKEY_Device_FriendlyName),
                read_prop(&store, &PKEY_DeviceInterface_FriendlyName),
            ),
            Err(_) => (String::new(), String::new(), String::new()),
        };
        Ok(EndpointInfo {
            id,
            name: endpoint_name(&desc, &friendly, &interface),
            friendly,
            interface,
            flow,
            state,
        })
    }
}

/// pid → full image path. Fails for protected/elevated processes we can't open.
fn image_path(pid: u32) -> Option<PathBuf> {
    if pid == 0 {
        return None;
    }
    // SAFETY: handle closed below; the buffer length is passed in and updated by the call.
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = vec![0u16; 1024];
        let mut len = buf.len() as u32;
        let r =
            QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(h);
        r.ok()?;
        Some(PathBuf::from(String::from_utf16_lossy(
            &buf[..len as usize],
        )))
    }
}

/// Version-info `FileDescription` (first translation), e.g. "Google Chrome".
fn file_description(exe: &Path) -> Option<String> {
    let path = HSTRING::from(exe.as_os_str());
    // SAFETY: buffers sized by GetFileVersionInfoSizeW; VerQueryValueW returns pointers into it.
    unsafe {
        let size = GetFileVersionInfoSizeW(&path, None);
        if size == 0 {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        GetFileVersionInfoW(&path, None, size, data.as_mut_ptr() as *mut _).ok()?;
        let mut ptr = std::ptr::null_mut();
        let mut len = 0u32;
        let lang_cp = if VerQueryValueW(
            data.as_ptr() as *const _,
            &HSTRING::from("\\VarFileInfo\\Translation"),
            &mut ptr,
            &mut len,
        )
        .as_bool()
            && len >= 4
        {
            let t = std::slice::from_raw_parts(ptr as *const u16, 2);
            format!("{:04x}{:04x}", t[0], t[1])
        } else {
            "040904b0".to_owned()
        };
        let sub = HSTRING::from(format!("\\StringFileInfo\\{lang_cp}\\FileDescription"));
        if !VerQueryValueW(data.as_ptr() as *const _, &sub, &mut ptr, &mut len).as_bool()
            || len == 0
        {
            return None;
        }
        let chars = std::slice::from_raw_parts(ptr as *const u16, len as usize);
        let s = String::from_utf16_lossy(chars);
        let s = s.trim_end_matches('\0').trim().to_owned();
        (!s.is_empty()).then_some(s)
    }
}

impl SessionsBackend for CoreAudio {
    fn is_fake(&self) -> bool {
        false
    }

    fn scan(
        &mut self,
        mapping: &Mapping,
        opts: &ScanOptions,
    ) -> Result<Vec<EndpointApps>, SessionsError> {
        let devices = self.endpoints(true)?;
        let infos: Vec<EndpointInfo> = devices.iter().map(|(i, _)| i.clone()).collect();
        let resolved = mapping.resolve(&infos);
        let mut live = HashMap::new();
        let mut seen_pids = Vec::new();
        let mut out = Vec::with_capacity(resolved.len());
        for (target, hit) in resolved {
            let mut ea = EndpointApps {
                target,
                endpoint: hit.map(|e| e.name.clone()),
                found: hit.is_some(),
                apps: Vec::new(),
            };
            if let Some(info) = hit
                && let Some((_, dev)) = devices.iter().find(|(i, _)| i.id == info.id)
            {
                match self.sessions_on(dev, opts, &mut live) {
                    Ok(raw) => ea.apps = raw.into_iter().map(|r| r.app).collect(),
                    Err(e) => log_once(&format!("sessions: {}: {e}", info.friendly)),
                }
            }
            seen_pids.extend(ea.apps.iter().map(|a| a.pid));
            ea.apps.sort_by(|a, b| {
                a.name
                    .to_lowercase()
                    .cmp(&b.name.to_lowercase())
                    .then_with(|| a.key.cmp(&b.key))
            });
            out.push(ea);
        }
        // Forget processes that have no session any more (pids get reused).
        self.procs.retain(|pid, _| seen_pids.contains(pid));
        self.live = live;
        Ok(out)
    }

    fn peaks(&mut self, out: &mut Vec<(String, f32)>) {
        out.clear();
        for (key, l) in &self.live {
            if let Some(m) = &l.meter {
                // SAFETY: COM call on a live meter interface.
                let p = unsafe { m.GetPeakValue() }.unwrap_or(0.0);
                out.push((key.clone(), p.clamp(0.0, 1.0)));
            }
        }
    }

    fn set_volume(&mut self, key: &str, volume: f32) -> Result<(), SessionsError> {
        let l = self.live.get(key).ok_or(SessionsError::UnknownApp)?;
        // SAFETY: COM call on a live interface; a null event context is allowed.
        unsafe { l.volume.SetMasterVolume(volume, &GUID::zeroed()) }.map_err(com("SetMasterVolume"))
    }

    fn set_mute(&mut self, key: &str, muted: bool) -> Result<(), SessionsError> {
        let l = self.live.get(key).ok_or(SessionsError::UnknownApp)?;
        // SAFETY: as above.
        unsafe { l.volume.SetMute(muted, &GUID::zeroed()) }.map_err(com("SetMute"))
    }
}

/// Logs each distinct message once per process (scans repeat every second).
fn log_once(msg: &str) {
    use std::collections::HashSet;
    use std::sync::Mutex;
    static SEEN: Mutex<Option<HashSet<String>>> = Mutex::new(None);
    if let Ok(mut g) = SEEN.lock() {
        let set = g.get_or_insert_with(HashSet::new);
        if set.len() < 256 && set.insert(msg.to_owned()) {
            log::warn!("{msg}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_follow_the_volume_mixer_order() {
        let p = ProcInfo {
            exe: Some(PathBuf::from(r"C:\Apps\spotify.exe")),
            description: Some("Spotify".into()),
            hidden: false,
        };
        assert_eq!(app_name(true, "x", &p, 1), "System sounds");
        assert_eq!(app_name(false, "Game Chat", &p, 1), "Game Chat");
        assert_eq!(app_name(false, "@%SystemRoot%\\x.dll,-1", &p, 1), "Spotify");
        let no_desc = ProcInfo {
            description: None,
            ..p
        };
        assert_eq!(app_name(false, "", &no_desc, 1), "spotify");
        assert_eq!(
            app_name(false, "", &ProcInfo::default(), 1234),
            "App (pid 1234)"
        );
    }

    #[test]
    fn voicemeeter_exes_are_hidden() {
        for exe in [
            r"C:\Program Files (x86)\VB\Voicemeeter\voicemeeter8x64.exe",
            r"C:\Program Files (x86)\VB\Voicemeeter\voicemeeter8.exe",
            r"C:\Program Files (x86)\VB\Voicemeeter\VoicemeeterPro.exe",
            r"C:\Program Files (x86)\VB\Voicemeeter\voicemeeter.exe",
            r"C:\Program Files (x86)\VB\Voicemeeter\VoicemeeterMacroButtons.exe",
        ] {
            assert!(is_voicemeeter_exe(Path::new(exe)), "{exe}");
        }
        assert!(!is_voicemeeter_exe(Path::new(r"C:\Apps\spotify.exe")));
    }

    #[test]
    fn own_process_is_hidden() {
        assert!(is_own_process(std::process::id(), None));
        let me = std::env::current_exe().ok();
        assert!(is_own_process(u32::MAX - 1, me.as_deref()));
        assert!(!is_own_process(
            u32::MAX - 1,
            Some(Path::new(r"C:\Apps\spotify.exe"))
        ));
    }
}
