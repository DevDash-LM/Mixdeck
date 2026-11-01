//! Param groups. The engine always reads `core` (the Mixer page) on dirty; detail
//! groups are read only while a view subscribes to them.
//!
//! **Adding a group:** add `groups/<name>.rs` with a `pub const KIND: GroupKind`
//! and add one line to `REGISTRY` below. Ids are `"<name>"` or `"<name>:<arg>"`
//! (e.g. `"strip_fx:2"`, `"bus_eq:0"`, `"devices"`); `build` receives the arg.

pub mod bus_eq;
pub mod core;
pub mod devices;
pub mod strip_fx;

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

use crate::vmr::VmrError;

use super::backend::VmBackend;

pub type GroupId = String;

/// The id of the always-on Mixer group. Subscribing to it is a no-op.
pub const CORE: &str = "core";

pub trait ParamGroup: Send {
    fn id(&self) -> GroupId;
    /// Reads the group. `Err(NoServer)` means Voicemeeter went away; any other error is shown
    /// to the subscribed view.
    fn read(&self, b: &dyn VmBackend) -> Result<serde_json::Value, VmrError>;
}

/// A kind of group and how to build one from the id's argument.
pub struct GroupKind {
    pub name: &'static str,
    pub build: fn(arg: Option<&str>) -> Option<Box<dyn ParamGroup>>,
}

// ---- Registrations: one line per group kind ----
const REGISTRY: &[GroupKind] = &[devices::KIND, strip_fx::KIND, bus_eq::KIND];

/// Resolves a group id to a group, or a user-readable error.
pub fn resolve(id: &str) -> Result<Box<dyn ParamGroup>, String> {
    resolve_in(REGISTRY, id)
}

pub(crate) fn resolve_in(registry: &[GroupKind], id: &str) -> Result<Box<dyn ParamGroup>, String> {
    let (name, arg) = match id.split_once(':') {
        Some((n, a)) => (n, Some(a)),
        None => (id, None),
    };
    let kind = registry
        .iter()
        .find(|k| k.name == name)
        .ok_or_else(|| format!("Unknown param group `{id}`."))?;
    (kind.build)(arg).ok_or_else(|| format!("Invalid param group id `{id}`."))
}

/// Parses an index argument (`"strip_fx:3"` → 3) and checks it is `< max`.
pub fn index_arg(arg: Option<&str>, max: usize) -> Option<usize> {
    arg?.parse::<usize>().ok().filter(|i| *i < max)
}

/// Lenient reads for the always-on core group: a parameter this Voicemeeter build doesn't
/// know is logged once and read as the default, so one odd param never blanks the Mixer.
/// `NoServer` still propagates.
pub struct Lenient<'a> {
    pub b: &'a dyn VmBackend,
}

impl Lenient<'_> {
    pub fn f32(&self, name: &str) -> Result<f32, VmrError> {
        match self.b.get_float(name) {
            Ok(v) if v.is_finite() => Ok(v),
            Ok(_) => Ok(0.0),
            Err(VmrError::NoServer) => Err(VmrError::NoServer),
            Err(e) => {
                warn_once(name, &e);
                Ok(0.0)
            }
        }
    }

    pub fn bool(&self, name: &str) -> Result<bool, VmrError> {
        Ok(self.f32(name)? >= 0.5)
    }

    pub fn string(&self, name: &str) -> Result<String, VmrError> {
        match self.b.get_string(name) {
            Ok(s) => Ok(s),
            Err(VmrError::NoServer) => Err(VmrError::NoServer),
            Err(e) => {
                warn_once(name, &e);
                Ok(String::new())
            }
        }
    }
}

fn warn_once(name: &str, e: &VmrError) {
    static SEEN: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    let seen = SEEN.get_or_init(|| Mutex::new(HashSet::new()));
    if let Ok(mut s) = seen.lock()
        && s.insert(name.to_owned())
    {
        log::warn!("engine: couldn't read `{name}` ({e}); using the default");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Dummy(usize);
    impl ParamGroup for Dummy {
        fn id(&self) -> GroupId {
            format!("dummy:{}", self.0)
        }
        fn read(&self, _b: &dyn VmBackend) -> Result<serde_json::Value, VmrError> {
            Ok(serde_json::json!({ "index": self.0 }))
        }
    }

    const TEST_REGISTRY: &[GroupKind] = &[GroupKind {
        name: "dummy",
        build: |arg| index_arg(arg, 8).map(|i| Box::new(Dummy(i)) as Box<dyn ParamGroup>),
    }];

    #[test]
    fn resolves_ids() {
        assert_eq!(
            resolve_in(TEST_REGISTRY, "dummy:3").map(|g| g.id()),
            Ok("dummy:3".into())
        );
        assert!(resolve_in(TEST_REGISTRY, "dummy:9").is_err());
        assert!(resolve_in(TEST_REGISTRY, "dummy").is_err());
        assert!(resolve_in(TEST_REGISTRY, "nope:1").is_err());
    }
}
