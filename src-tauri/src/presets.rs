//! Presets: JSON snapshots of param groups in `%APPDATA%/Mixdeck/presets/*.json`.
//!
//! **Save** = build the param names of the chosen groups (through `vmr::params`, by strip/bus
//! type, so no phantom params are stored), read them all in one
//! engine round trip (`Command::ReadParams`), write the file.
//! **Load** = keep only names that the preset's groups would produce (a hand-edited file can't
//! inject `Command.*` or anything else), build a script with `params::script::Builder`, split
//! it into ≤ 48 kB chunks, and apply chunks plus labels (`set_string`) in one
//! `Command::ApplyBatch`.
//!
//! A preset's id is its file stem. It's chosen from the name at save time and never changes,
//! so hotkeys (`LoadPreset{id}`) survive a rename.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Listener, Manager};
use ts_rs::TS;

use crate::engine::groups::{self, bus_eq, strip_fx};
use crate::engine::state::{ConnectionState, ParamValue, VmEdition};
use crate::engine::{BatchFailure, Command, Engine, ParamKind};
use crate::notify::{self, Notice, NoticeKind};
use crate::tray::{self, PresetMenuItem};
use crate::vmr::layout::{self, BUSES, STRIPS};
use crate::vmr::params::{self, BusMode, EqField, script::Builder};

pub const SCHEMA: u32 = 1;
pub const EVENT_CHANGED: &str = "presets://changed";
const NAME_MAX: usize = 64;
const SLUG_MAX: usize = 48;
const TRAY_MAX: usize = 30;

#[derive(Debug, thiserror::Error)]
pub enum PresetError {
    #[error("Couldn't find the presets folder: {0}")]
    Dir(String),
    #[error("Couldn't read or write preset files: {0}")]
    Io(#[from] std::io::Error),
    #[error("This preset file isn't valid: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("This preset was made by a newer Mixdeck (format {0}). Update Mixdeck to load it.")]
    NewerSchema(u32),
    #[error("Preset “{0}” wasn't found. It may have been deleted.")]
    NotFound(String),
    #[error("{0}")]
    Invalid(String),
    #[error("A preset named “{0}” already exists.")]
    NameTaken(String),
    #[error("{0}")]
    Engine(String),
}

type Result<T> = std::result::Result<T, PresetError>;

/// The file format.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct Preset {
    pub schema: u32,
    pub name: String,
    /// Unix time in milliseconds.
    #[ts(type = "number")]
    pub created_at: u64,
    pub vm_type: VmEdition,
    /// Group ids: `"core"`, `"strip_fx:{i}"`, `"bus_eq:{j}"`.
    pub groups: Vec<String>,
    pub params: BTreeMap<String, ParamValue>,
}

/// One entry of `list_presets`. A file that can't be read is listed with `error` set, so the
/// user can still delete it.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct PresetSummary {
    pub id: String,
    pub name: String,
    #[ts(type = "number")]
    pub created_at: u64,
    pub vm_type: Option<VmEdition>,
    pub groups: Vec<String>,
    pub param_count: u32,
    pub error: Option<String>,
}

/// Result of `load_preset`. `errors` lists rejected script lines / labels (the rest applied).
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/generated/")]
pub struct LoadReport {
    pub id: String,
    pub name: String,
    pub applied: u32,
    /// Params in the file that aren't part of its groups (ignored).
    pub skipped: u32,
    pub errors: Vec<String>,
}

// ---------------------------------------------------------------------------------------------
// Groups → param names
// ---------------------------------------------------------------------------------------------

/// Group ids a preset may contain, in display order.
pub fn known_groups() -> Vec<String> {
    let mut v = vec![groups::CORE.to_string()];
    v.extend((0..STRIPS).map(strip_fx::id));
    v.extend((0..BUSES).map(bus_eq::id));
    v
}

fn cells(out: &mut Vec<(String, ParamKind)>, name: impl Fn(usize, usize, EqField) -> String) {
    for ch in 0..strip_fx::EQ_CHANNELS {
        for cell in 0..strip_fx::EQ_CELLS {
            for f in EqField::ALL {
                out.push((name(ch, cell, f), ParamKind::Float));
            }
        }
    }
}

/// The params a group snapshots, or `None` for an unknown id. Built by strip/bus type so
/// params that type doesn't have are never stored.
pub fn group_params(id: &str) -> Option<Vec<(String, ParamKind)>> {
    use ParamKind::{Float as F, String as S};
    let mut out = Vec::new();
    let (name, arg) = match id.split_once(':') {
        Some((n, a)) => (n, Some(a)),
        None => (id, None),
    };
    match name {
        groups::CORE if arg.is_none() => {
            for i in 0..STRIPS {
                let p = params::strip(i);
                out.extend([(p.label(), S), (p.gain(), F), (p.mute(), F), (p.solo(), F)]);
                out.extend((0..BUSES).map(|j| (p.route(j), F)));
                if layout::is_hardware_strip(i) {
                    out.extend([
                        (p.mono(), F),
                        (p.comp(), F),
                        (p.gate(), F),
                        (p.denoiser(), F),
                    ]);
                } else {
                    out.extend([(p.mc(), F), (p.eq_on(), F)]);
                    out.extend((1..=3).map(|n| (p.eq_gain(n), F)));
                }
            }
            for j in 0..BUSES {
                let p = params::bus(j);
                out.extend([
                    (p.label(), S),
                    (p.gain(), F),
                    (p.mute(), F),
                    (p.mono(), F),
                    (p.eq_on(), F),
                ]);
                out.extend(BusMode::ALL.iter().map(|m| (p.mode(*m), F)));
            }
        }
        strip_fx::NAME => {
            let i = groups::index_arg(arg, STRIPS)?;
            let p = params::strip(i);
            out.push((p.limit(), F));
            if layout::is_hardware_strip(i) {
                out.extend(
                    [
                        p.comp_gain_in(),
                        p.comp_ratio(),
                        p.comp_threshold(),
                        p.comp_attack(),
                        p.comp_release(),
                        p.comp_knee(),
                        p.comp_gain_out(),
                        p.comp_makeup(),
                        p.gate_threshold(),
                        p.gate_damping(),
                        p.gate_bp_sidechain(),
                        p.gate_attack(),
                        p.gate_hold(),
                        p.gate_release(),
                    ]
                    .into_iter()
                    .map(|n| (n, F)),
                );
            }
            out.extend([(p.eq_on(), F), (p.eq_ab(), F)]);
            cells(&mut out, |ch, c, f| p.eq_cell(ch, c, f));
        }
        bus_eq::NAME => {
            let j = groups::index_arg(arg, BUSES)?;
            let p = params::bus(j);
            out.extend([(p.eq_on(), F), (p.eq_ab(), F)]);
            for ch in 0..strip_fx::EQ_CHANNELS {
                out.extend([(p.eq_trim(ch), F), (p.eq_delay(ch), F)]);
            }
            cells(&mut out, |ch, c, f| p.eq_cell(ch, c, f));
        }
        _ => return None,
    }
    Some(out)
}

/// `Bus[j].mode.*` flag names (only the active one is stored).
fn mode_flags() -> BTreeSet<String> {
    (0..BUSES)
        .flat_map(|j| BusMode::ALL.iter().map(move |m| params::bus(j).mode(*m)))
        .collect()
}

/// Normalises and validates a group list (dedup, known ids only, display order).
fn normalize_groups(requested: &[String]) -> Result<Vec<String>> {
    let wanted: BTreeSet<&str> = requested.iter().map(|s| s.trim()).collect();
    if let Some(bad) = wanted.iter().find(|g| group_params(g).is_none()) {
        return Err(PresetError::Invalid(format!(
            "Unknown param group `{bad}`."
        )));
    }
    let out: Vec<String> = known_groups()
        .into_iter()
        .filter(|g| wanted.contains(g.as_str()))
        .collect();
    if out.is_empty() {
        return Err(PresetError::Invalid(
            "Choose at least one thing to save.".into(),
        ));
    }
    Ok(out)
}

/// Turns read values into the stored map: drops unreadable params and keeps only the bus
/// mode flag that is on (writing `mode.<x> = 1` selects it on load).
fn build_params(
    names: &[(String, ParamKind)],
    values: Vec<Option<ParamValue>>,
) -> BTreeMap<String, ParamValue> {
    let flags = mode_flags();
    let mut out = BTreeMap::new();
    for ((name, _), v) in names.iter().zip(values) {
        let Some(v) = v else { continue };
        if flags.contains(name) && !matches!(v, ParamValue::Num(x) if x >= 0.5) {
            continue;
        }
        out.insert(name.clone(), v);
    }
    out
}

/// What a load would send: the script (floats) and the labels, plus how many params were
/// ignored because they're not part of the preset's groups.
struct Plan {
    builder: Builder,
    strings: Vec<(String, String)>,
    skipped: u32,
}

fn plan_load(preset: &Preset) -> Plan {
    let allowed: BTreeMap<String, ParamKind> = preset
        .groups
        .iter()
        .filter_map(|g| group_params(g))
        .flatten()
        .collect();
    let mut builder = Builder::new();
    let mut strings = Vec::new();
    let mut skipped = 0;
    for (name, value) in &preset.params {
        match (allowed.get(name), value) {
            (Some(ParamKind::Float), ParamValue::Num(v)) if v.is_finite() => {
                builder.push_float(name, *v);
            }
            (Some(ParamKind::String), ParamValue::Str(s)) => {
                strings.push((name.clone(), s.clone()))
            }
            _ => skipped += 1,
        }
    }
    Plan {
        builder,
        strings,
        skipped,
    }
}

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

pub fn presets_dir(app: &AppHandle) -> Result<PathBuf> {
    let base = app
        .path()
        .data_dir()
        .map_err(|e| PresetError::Dir(e.to_string()))?;
    Ok(base.join("Mixdeck").join("presets"))
}

fn ensure_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = presets_dir(app)?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Rejects ids that could escape the folder.
fn file_for(dir: &Path, id: &str) -> Result<PathBuf> {
    let ok = !id.is_empty()
        && id.len() <= 128
        && id != "."
        && id != ".."
        && !id
            .chars()
            .any(|c| matches!(c, '/' | '\\' | ':' | '\0') || c.is_control());
    if !ok {
        return Err(PresetError::NotFound(id.to_string()));
    }
    Ok(dir.join(format!("{id}.json")))
}

pub fn slug(name: &str) -> String {
    let mut s = String::new();
    for c in name.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_alphanumeric() {
            s.push(c);
        } else if !s.ends_with('-') && !s.is_empty() {
            s.push('-');
        }
        if s.len() >= SLUG_MAX {
            break;
        }
    }
    let s = s.trim_matches('-').to_string();
    if s.is_empty() { "preset".into() } else { s }
}

fn clean_name(name: &str) -> Result<String> {
    let n: String = name
        .trim()
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    if n.is_empty() {
        return Err(PresetError::Invalid("Give the preset a name.".into()));
    }
    if n.chars().count() > NAME_MAX {
        return Err(PresetError::Invalid(format!(
            "Preset names can be up to {NAME_MAX} characters."
        )));
    }
    Ok(n)
}

fn read_file(path: &Path) -> Result<Preset> {
    let text = std::fs::read_to_string(path)?;
    let value: serde_json::Value = serde_json::from_str(&text)?;
    let schema = value.get("schema").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    if schema > SCHEMA {
        return Err(PresetError::NewerSchema(schema));
    }
    Ok(serde_json::from_value(value)?)
}

/// Writes via a temp file + rename so a crash never leaves half a preset.
fn write_file(path: &Path, preset: &Preset) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(preset)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn list_in(dir: &Path) -> Result<Vec<PresetSummary>> {
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(e.into()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()).map(str::to_owned) else {
            continue;
        };
        out.push(match read_file(&path) {
            Ok(p) => PresetSummary {
                id,
                name: p.name,
                created_at: p.created_at,
                vm_type: Some(p.vm_type),
                groups: p.groups,
                param_count: p.params.len() as u32,
                error: None,
            },
            Err(e) => PresetSummary {
                name: id.clone(),
                id,
                created_at: 0,
                vm_type: None,
                groups: Vec::new(),
                param_count: 0,
                error: Some(e.to_string()),
            },
        });
    }
    out.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then(a.id.cmp(&b.id))
    });
    Ok(out)
}

fn find_by_name<'a>(list: &'a [PresetSummary], name: &str) -> Option<&'a PresetSummary> {
    let key = name.trim().to_lowercase();
    list.iter()
        .find(|p| p.error.is_none() && p.name.trim().to_lowercase() == key)
}

fn unique_id(list: &[PresetSummary], base: &str) -> String {
    let taken = |id: &str| list.iter().any(|p| p.id.eq_ignore_ascii_case(id));
    if !taken(base) {
        return base.to_string();
    }
    (2..)
        .map(|n| format!("{base}-{n}"))
        .find(|id| !taken(id))
        .unwrap_or_else(|| format!("{base}-{}", now_ms()))
}

// ---------------------------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------------------------

pub fn list(app: &AppHandle) -> Result<Vec<PresetSummary>> {
    list_in(&presets_dir(app)?)
}

/// Refreshes the tray submenu and tells the frontend.
fn changed(app: &AppHandle) {
    match list(app) {
        Ok(list) => {
            update_tray(app, &list);
            if let Err(e) = app.emit(EVENT_CHANGED, &list) {
                log::warn!("presets: couldn't emit {EVENT_CHANGED}: {e}");
            }
        }
        Err(e) => log::warn!("presets: couldn't list presets: {e}"),
    }
}

fn update_tray(app: &AppHandle, list: &[PresetSummary]) {
    let items: Vec<PresetMenuItem> = list
        .iter()
        .filter(|p| p.error.is_none())
        .take(TRAY_MAX)
        .map(|p| PresetMenuItem {
            id: p.id.clone(),
            label: p.name.clone(),
        })
        .collect();
    if let Err(e) = tray::set_presets_menu(app, &items) {
        log::warn!("presets: couldn't update the tray menu: {e}");
    }
}

fn connected_edition(engine: &Engine) -> Result<VmEdition> {
    match engine.state().connection {
        ConnectionState::Connected { vm_type, .. } => Ok(vm_type),
        _ => Err(PresetError::Engine("Voicemeeter isn't connected.".into())),
    }
}

pub async fn save(
    app: &AppHandle,
    name: &str,
    groups: &[String],
    overwrite: bool,
) -> Result<PresetSummary> {
    let name = clean_name(name)?;
    let groups = normalize_groups(groups)?;
    let dir = ensure_dir(app)?;
    let existing = list_in(&dir)?;
    let id = match find_by_name(&existing, &name) {
        Some(p) if overwrite => p.id.clone(),
        Some(p) => return Err(PresetError::NameTaken(p.name.clone())),
        None => unique_id(&existing, &slug(&name)),
    };

    let engine = app.state::<Engine>();
    let vm_type = connected_edition(&engine)?;
    let names: Vec<(String, ParamKind)> = groups
        .iter()
        .filter_map(|g| group_params(g))
        .flatten()
        .collect::<BTreeMap<_, _>>()
        .into_iter()
        .collect();
    let to_read = names.clone();
    let values = engine
        .request(|reply| Command::ReadParams {
            params: to_read,
            reply,
        })
        .await
        .map_err(PresetError::Engine)?;
    let params = build_params(&names, values);
    let preset = Preset {
        schema: SCHEMA,
        name,
        created_at: now_ms(),
        vm_type,
        groups,
        params,
    };
    write_file(&file_for(&dir, &id)?, &preset)?;
    log::info!(
        "presets: saved `{id}` ({} params, groups {:?})",
        preset.params.len(),
        preset.groups
    );
    changed(app);
    Ok(PresetSummary {
        id,
        name: preset.name,
        created_at: preset.created_at,
        vm_type: Some(preset.vm_type),
        groups: preset.groups,
        param_count: preset.params.len() as u32,
        error: None,
    })
}

pub async fn load(app: &AppHandle, id: &str) -> Result<LoadReport> {
    let path = file_for(&presets_dir(app)?, id)?;
    if !path.exists() {
        return Err(PresetError::NotFound(id.to_string()));
    }
    let preset = read_file(&path)?;
    let engine = app.state::<Engine>();
    let edition = connected_edition(&engine)?;
    let Plan {
        builder,
        strings,
        skipped,
    } = plan_load(&preset);
    if builder.is_empty() && strings.is_empty() {
        return Err(PresetError::Invalid(
            "This preset has nothing to load.".into(),
        ));
    }
    let applied = (builder.len() + strings.len()) as u32;
    let chunks = builder.chunks();
    let lines: Vec<Vec<String>> = chunks
        .iter()
        .map(|c| c.lines().map(str::to_owned).collect())
        .collect();
    let failures = engine
        .request(|reply| Command::ApplyBatch {
            scripts: chunks,
            strings,
            reply,
        })
        .await
        .map_err(PresetError::Engine)?;
    let errors: Vec<String> = failures
        .into_iter()
        .map(|f| match f {
            BatchFailure::Script {
                script,
                line: Some(n),
                ..
            } => {
                let text = lines
                    .get(script)
                    .and_then(|l| l.get(n - 1))
                    .map(String::as_str)
                    .unwrap_or("?");
                format!(
                    "Voicemeeter rejected `{text}` (part {}, line {n}).",
                    script + 1
                )
            }
            BatchFailure::Script {
                script, message, ..
            } => format!("Part {} wasn't applied: {message}", script + 1),
            BatchFailure::String { name, message } => format!("`{name}`: {message}"),
        })
        .collect();
    if edition != preset.vm_type {
        log::warn!(
            "presets: `{id}` was saved on {:?}, loading on {edition:?}",
            preset.vm_type
        );
    }
    log::info!(
        "presets: loaded `{id}` ({applied} params, {skipped} skipped, {} errors)",
        errors.len()
    );
    Ok(LoadReport {
        id: id.to_string(),
        name: preset.name,
        applied,
        skipped,
        errors,
    })
}

pub fn rename(app: &AppHandle, id: &str, name: &str) -> Result<PresetSummary> {
    let name = clean_name(name)?;
    let dir = presets_dir(app)?;
    let path = file_for(&dir, id)?;
    if !path.exists() {
        return Err(PresetError::NotFound(id.to_string()));
    }
    let list = list_in(&dir)?;
    if let Some(other) = find_by_name(&list, &name).filter(|p| p.id != id) {
        return Err(PresetError::NameTaken(other.name.clone()));
    }
    let mut preset = read_file(&path)?;
    preset.name = name;
    write_file(&path, &preset)?;
    changed(app);
    Ok(PresetSummary {
        id: id.to_string(),
        name: preset.name,
        created_at: preset.created_at,
        vm_type: Some(preset.vm_type),
        groups: preset.groups,
        param_count: preset.params.len() as u32,
        error: None,
    })
}

pub fn delete(app: &AppHandle, id: &str) -> Result<()> {
    let path = file_for(&presets_dir(app)?, id)?;
    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(PresetError::NotFound(id.to_string()));
        }
        Err(e) => return Err(e.into()),
    }
    log::info!("presets: deleted `{id}`");
    changed(app);
    Ok(())
}

pub fn open_folder(app: &AppHandle) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    let dir = ensure_dir(app)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| PresetError::Invalid(format!("Couldn't open the folder: {e}")))
}

// ---- Voicemeeter XML (Command.Save / Command.Load) ----

fn xml_path(path: &str, must_exist: bool) -> Result<PathBuf> {
    let p = PathBuf::from(path.trim());
    if !p.is_absolute() {
        return Err(PresetError::Invalid("Choose a full file path.".into()));
    }
    let is_xml = p
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("xml"));
    if !is_xml {
        return Err(PresetError::Invalid(
            "Voicemeeter settings files end in .xml.".into(),
        ));
    }
    if must_exist && !p.is_file() {
        return Err(PresetError::Invalid(format!(
            "{} doesn't exist.",
            p.display()
        )));
    }
    Ok(p)
}

fn modified(p: &Path) -> Option<SystemTime> {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
}

/// Asks Voicemeeter to save its whole configuration to `path`. Voicemeeter writes the file
/// itself; with the real engine this waits up to 3 s for it to appear.
pub async fn export_xml(app: &AppHandle, path: &str) -> Result<String> {
    let p = xml_path(path, false)?;
    let engine = app.state::<Engine>();
    connected_edition(&engine)?;
    let before = modified(&p);
    let value = p.to_string_lossy().into_owned();
    engine
        .request(|reply| Command::SetParam {
            name: params::command::save(),
            value: ParamValue::Str(value),
            reply,
        })
        .await
        .map_err(PresetError::Engine)?;
    if engine.info().backend == crate::engine::state::BackendKind::Fake {
        return Ok("Demo mode: the simulated engine doesn't write files.".into());
    }
    for _ in 0..30 {
        if modified(&p).is_some_and(|m| Some(m) != before) {
            log::info!("presets: Voicemeeter saved its settings to {}", p.display());
            return Ok(format!("Saved to {}", p.display()));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err(PresetError::Invalid(format!(
        "Voicemeeter didn't write {} yet. Check the folder is writable.",
        p.display()
    )))
}

/// Asks Voicemeeter to load a configuration file (its own XML format). Sent on its own
/// because `Command.Load` resets the rest of its script packet.
pub async fn import_xml(app: &AppHandle, path: &str) -> Result<()> {
    let p = xml_path(path, true)?;
    let engine = app.state::<Engine>();
    connected_edition(&engine)?;
    let value = p.to_string_lossy().into_owned();
    engine
        .request(|reply| Command::SetParam {
            name: params::command::load(),
            value: ParamValue::Str(value),
            reply,
        })
        .await
        .map_err(PresetError::Engine)?;
    log::info!("presets: asked Voicemeeter to load {}", p.display());
    // Voicemeeter applies the file asynchronously; make sure the Mixer re-reads.
    let _ = engine
        .request(|reply| Command::RefreshGroup {
            id: groups::CORE.into(),
            reply,
        })
        .await;
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Startup and background loads (tray, hotkeys)
// ---------------------------------------------------------------------------------------------

/// Loads a preset outside the UI (tray or hotkey) and reports the result as a toast.
pub fn load_in_background(app: &AppHandle, id: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let notice = match load(&app, &id).await {
            Ok(r) if r.errors.is_empty() => {
                Notice::new(NoticeKind::Success, format!("Loaded “{}”", r.name))
            }
            Ok(r) => Notice::new(
                NoticeKind::Error,
                format!("Loaded “{}” with errors", r.name),
            )
            .description(r.errors.join(" ")),
            Err(e) => Notice::new(NoticeKind::Error, "Couldn't load the preset")
                .description(e.to_string()),
        };
        notify::toast(&app, notice.key("preset-load"));
    });
}

/// Fills the tray submenu and handles its clicks in Rust (so it works while hidden).
/// Call from `setup`, after `tray::init` and `engine::init`.
pub fn init(app: &AppHandle) {
    match list(app) {
        Ok(list) => update_tray(app, &list),
        Err(e) => log::warn!("presets: couldn't list presets: {e}"),
    }
    let handle = app.clone();
    app.listen_any(tray::EVENT_PRESET, move |event| {
        let id: String = serde_json::from_str(event.payload()).unwrap_or_default();
        if !id.is_empty() {
            load_in_background(&handle, id);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::backend::VmBackend;
    use crate::engine::fake::{FakeBackend, FakeStart};

    fn snapshot(f: &FakeBackend, groups: &[String]) -> BTreeMap<String, ParamValue> {
        let names: Vec<(String, ParamKind)> = groups
            .iter()
            .filter_map(|g| group_params(g))
            .flatten()
            .collect::<BTreeMap<_, _>>()
            .into_iter()
            .collect();
        let values = names
            .iter()
            .map(|(n, k)| match k {
                ParamKind::Float => f.get_float(n).ok().map(ParamValue::Num),
                ParamKind::String => f.get_string(n).ok().map(ParamValue::Str),
            })
            .collect();
        build_params(&names, values)
    }

    fn preset(groups: Vec<String>, params: BTreeMap<String, ParamValue>) -> Preset {
        Preset {
            schema: SCHEMA,
            name: "Test".into(),
            created_at: 1,
            vm_type: VmEdition::Potato,
            groups,
            params,
        }
    }

    #[test]
    fn every_known_group_has_params() {
        for g in known_groups() {
            assert!(!group_params(&g).unwrap().is_empty(), "{g}");
        }
        assert!(group_params("strip_fx:8").is_none());
        assert!(group_params("devices").is_none());
        assert!(group_params("core:1").is_none());
    }

    #[test]
    fn no_phantom_params() {
        let hw = group_params("strip_fx:0").unwrap();
        let virt = group_params("strip_fx:5").unwrap();
        assert!(hw.iter().any(|(n, _)| n == "Strip[0].Comp.Ratio"));
        assert!(
            !virt
                .iter()
                .any(|(n, _)| n.contains("Comp") || n.contains("Gate"))
        );
        let core = group_params("core").unwrap();
        assert!(!core.iter().any(|(n, _)| n == "Strip[0].EQGain1"));
        assert!(!core.iter().any(|(n, _)| n == "Strip[5].Denoiser"));
        assert!(core.iter().any(|(n, _)| n == "Strip[5].EQGain1"));
    }

    #[test]
    fn only_active_bus_mode_is_stored() {
        let f = FakeBackend::new(FakeStart::Running);
        let p = snapshot(&f, &["core".into()]);
        let b7: Vec<_> = p.keys().filter(|k| k.starts_with("Bus[7].mode.")).collect();
        assert_eq!(b7, vec!["Bus[7].mode.Composite"]);
        assert!(p.keys().all(|k| !k.starts_with("Command")));
    }

    #[test]
    fn save_change_load_restores() {
        let mut f = FakeBackend::new(FakeStart::Running);
        let groups = normalize_groups(&known_groups()).unwrap();
        let saved = snapshot(&f, &groups);
        let pre = preset(groups.clone(), saved.clone());

        // Change ten things.
        let edits: [(&str, f32); 9] = [
            ("Strip[0].Gain", -20.0),
            ("Strip[1].Mute", 1.0),
            ("Strip[3].A2", 1.0),
            ("Bus[0].Gain", -9.5),
            ("Bus[7].mode.TVMix", 1.0),
            ("Strip[0].Comp.Ratio", 7.0),
            ("Strip[2].EQ.channel[3].cell[2].f", 4321.0),
            ("Bus[0].EQ.channel[0].cell[1].gain", -11.0),
            ("Bus[2].EQ.channel[1].Trim", 3.0),
        ];
        for (n, v) in edits {
            f.set_float(n, v).unwrap();
        }
        f.set_string("Strip[6].Label", "Changed").unwrap();
        assert_ne!(snapshot(&f, &groups), saved);

        let plan = plan_load(&pre);
        assert_eq!(plan.skipped, 0);
        for chunk in plan.builder.chunks() {
            assert!(chunk.len() <= params::script::MAX_BYTES);
            f.set_script(&chunk).unwrap();
        }
        for (n, s) in &plan.strings {
            f.set_string(n, s).unwrap();
        }
        assert_eq!(snapshot(&f, &groups), saved);
    }

    #[test]
    fn load_ignores_params_outside_groups() {
        let mut params = BTreeMap::new();
        params.insert("Strip[0].Gain".into(), ParamValue::Num(-3.0));
        params.insert("Command.Restart".into(), ParamValue::Num(1.0));
        params.insert("Strip[0].Comp.Ratio".into(), ParamValue::Num(2.0)); // not in core
        params.insert("Strip[0].Mute".into(), ParamValue::Str("x".into())); // wrong type
        let plan = plan_load(&preset(vec!["core".into()], params));
        assert_eq!(plan.builder.build(), "Strip[0].Gain = -3");
        assert_eq!(plan.skipped, 3);
    }

    #[test]
    fn groups_are_validated() {
        assert!(normalize_groups(&[]).is_err());
        assert!(normalize_groups(&["devices".into()]).is_err());
        assert_eq!(
            normalize_groups(&["bus_eq:1".into(), "core".into(), "core".into()]).unwrap(),
            vec!["core".to_string(), "bus_eq:1".into()]
        );
    }

    #[test]
    fn slugs_and_ids() {
        assert_eq!(slug("  Stream / Night Mix! "), "stream-night-mix");
        assert_eq!(slug("ÄÖÜ"), "preset");
        let dir = Path::new("C:/x");
        assert!(file_for(dir, "../evil").is_err());
        assert!(file_for(dir, "a\\b").is_err());
        assert!(file_for(dir, "ok-id").is_ok());
    }

    #[test]
    fn newer_schema_is_refused() {
        let dir = std::env::temp_dir().join(format!("mixdeck-presets-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("future.json");
        std::fs::write(&path, r#"{"schema":2,"name":"x"}"#).unwrap();
        assert!(matches!(read_file(&path), Err(PresetError::NewerSchema(2))));
        std::fs::write(dir.join("broken.json"), "{").unwrap();
        let list = list_in(&dir).unwrap();
        assert_eq!(list.len(), 2);
        assert!(list.iter().all(|p| p.error.is_some()));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
