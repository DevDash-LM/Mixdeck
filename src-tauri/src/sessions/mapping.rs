//! Which Windows endpoint feeds which strip/bus. Pure data and logic, no COM, so it's tested here.
//!
//! Voicemeeter's virtual inputs are Windows **playback** endpoints and its B buses are
//! **recording** endpoints. Verified on the build PC with `sessions_probe` (Voicemeeter Potato
//! 3.1.3.0): **every** Voicemeeter endpoint shares one device-interface
//! name, "VB-Audio Voicemeeter VAIO" (render: Voicemeeter Input / AUX Input / VAIO3 Input /
//! In 1–5; capture: Out A1–A5 / B1–B3). So endpoints are told apart by their **endpoint name**
//! (`PKEY_Device_DeviceDesc`, e.g. "Voicemeeter AUX Input"); the interface name only confirms
//! the endpoint belongs to Voicemeeter.

use super::types::{EndpointRule, SessionTarget, SessionTargetKind};

/// Data-flow direction of a Windows audio endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Flow {
    /// Playback (apps play into it): a Voicemeeter virtual input strip.
    Render,
    /// Recording (apps record from it): a Voicemeeter B bus.
    Capture,
}

impl Flow {
    pub fn label(self) -> &'static str {
        match self {
            Flow::Render => "render",
            Flow::Capture => "capture",
        }
    }
}

/// `DEVICE_STATE_*`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndpointState {
    Active,
    Disabled,
    NotPresent,
    Unplugged,
}

impl EndpointState {
    pub fn from_raw(v: u32) -> Self {
        match v {
            1 => Self::Active,
            2 => Self::Disabled,
            4 => Self::NotPresent,
            _ => Self::Unplugged,
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Disabled => "disabled",
            Self::NotPresent => "not present",
            Self::Unplugged => "unplugged",
        }
    }
}

/// One Windows endpoint as the mapping sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EndpointInfo {
    /// `IMMDevice::GetId`.
    pub id: String,
    /// Endpoint name, `PKEY_Device_DeviceDesc`, e.g. "Voicemeeter AUX Input" (see `endpoint_name`).
    pub name: String,
    /// `PKEY_Device_FriendlyName`, e.g. "Voicemeeter AUX Input (VB-Audio Voicemeeter VAIO)".
    pub friendly: String,
    /// `PKEY_DeviceInterface_FriendlyName`, e.g. "VB-Audio Voicemeeter VAIO".
    pub interface: String,
    pub flow: Flow,
    pub state: EndpointState,
}

/// The endpoint name: the device description, or else the friendly name without its
/// " (interface)" suffix.
pub fn endpoint_name(desc: &str, friendly: &str, interface: &str) -> String {
    let desc = desc.trim();
    if !desc.is_empty() {
        return desc.to_owned();
    }
    let suffix = format!(" ({})", interface.trim());
    friendly
        .trim()
        .strip_suffix(&suffix)
        .unwrap_or(friendly.trim())
        .to_owned()
}

/// The six targets, in the order `SessionsState.endpoints` lists them.
pub const TARGETS: [SessionTarget; 6] = [
    SessionTarget::strip(5),
    SessionTarget::strip(6),
    SessionTarget::strip(7),
    SessionTarget::bus(5),
    SessionTarget::bus(6),
    SessionTarget::bus(7),
];

/// Default endpoints must have an interface name starting with this (normalised).
pub const VOICEMEETER_INTERFACE: &str = "vb-audio voicemeeter";

/// Default endpoint names (Voicemeeter Potato 3.1.3.0, verified with `sessions_probe`).
pub fn default_endpoint(target: SessionTarget) -> Option<&'static str> {
    match (target.kind, target.index) {
        (SessionTargetKind::Strip, 5) => Some("Voicemeeter Input"),
        (SessionTargetKind::Strip, 6) => Some("Voicemeeter AUX Input"),
        (SessionTargetKind::Strip, 7) => Some("Voicemeeter VAIO3 Input"),
        (SessionTargetKind::Bus, 5) => Some("Voicemeeter Out B1"),
        (SessionTargetKind::Bus, 6) => Some("Voicemeeter Out B2"),
        (SessionTargetKind::Bus, 7) => Some("Voicemeeter Out B3"),
        _ => None,
    }
}

pub fn is_target(target: SessionTarget) -> bool {
    TARGETS.contains(&target)
}

/// Strips are fed by playback endpoints, buses record into capture endpoints.
pub fn flow_for(target: SessionTarget) -> Flow {
    match target.kind {
        SessionTargetKind::Strip => Flow::Render,
        SessionTargetKind::Bus => Flow::Capture,
    }
}

fn norm(s: &str) -> String {
    s.trim().to_lowercase()
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Rule {
    target: SessionTarget,
    /// Normalised endpoint name.
    name: String,
    /// Defaults only match Voicemeeter's own endpoints; a Settings override matches any device.
    voicemeeter_only: bool,
}

/// Effective table: defaults with Settings overrides applied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mapping {
    /// Same order as `TARGETS`.
    rules: Vec<Rule>,
}

impl Default for Mapping {
    fn default() -> Self {
        Self::new(&[])
    }
}

impl Mapping {
    /// Invalid rules (unknown target, empty name) are ignored; `validate_rules` rejects them
    /// before they're saved.
    pub fn new(overrides: &[EndpointRule]) -> Self {
        let rules = TARGETS
            .iter()
            .map(|&t| {
                match overrides
                    .iter()
                    .find(|r| r.target == t && !r.endpoint.trim().is_empty())
                {
                    Some(r) => Rule {
                        target: t,
                        name: norm(&r.endpoint),
                        voicemeeter_only: false,
                    },
                    None => Rule {
                        target: t,
                        name: norm(default_endpoint(t).unwrap_or_default()),
                        voicemeeter_only: true,
                    },
                }
            })
            .collect();
        Self { rules }
    }

    /// Endpoint name (normalised) a target is matched against.
    pub fn endpoint_for(&self, target: SessionTarget) -> Option<&str> {
        self.rules
            .iter()
            .find(|r| r.target == target)
            .map(|r| r.name.as_str())
    }

    /// The target an endpoint feeds, if any (any state). Exact, case-insensitive name match,
    /// so "Voicemeeter Input" never claims "Voicemeeter In 2" or "Voicemeeter AUX Input".
    pub fn target_for(&self, e: &EndpointInfo) -> Option<SessionTarget> {
        let name = norm(&e.name);
        if name.is_empty() {
            return None;
        }
        let is_vm = norm(&e.interface).starts_with(VOICEMEETER_INTERFACE);
        self.rules
            .iter()
            .find(|r| {
                flow_for(r.target) == e.flow && r.name == name && (is_vm || !r.voicemeeter_only)
            })
            .map(|r| r.target)
    }

    /// For each target (in `TARGETS` order), the first **active** endpoint that maps to it.
    pub fn resolve<'a>(
        &self,
        endpoints: &'a [EndpointInfo],
    ) -> Vec<(SessionTarget, Option<&'a EndpointInfo>)> {
        TARGETS
            .iter()
            .map(|&t| {
                let hit = endpoints
                    .iter()
                    .find(|e| e.state == EndpointState::Active && self.target_for(e) == Some(t));
                (t, hit)
            })
            .collect()
    }
}

/// Settings validation for `AppsSettings.endpoint_rules`.
pub fn validate_rules(rules: &[EndpointRule]) -> Result<(), String> {
    if rules.len() > TARGETS.len() {
        return Err(format!("At most {} endpoint rules.", TARGETS.len()));
    }
    for (i, r) in rules.iter().enumerate() {
        if !is_target(r.target) {
            return Err(format!(
                "Rule {}: only strips 5–7 and buses 5–7 have app sessions.",
                i + 1
            ));
        }
        if r.endpoint.trim().is_empty() {
            return Err(format!("Rule {}: the endpoint name is empty.", i + 1));
        }
        if rules[..i].iter().any(|o| o.target == r.target) {
            return Err(format!("Rule {}: that target already has a rule.", i + 1));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const VM: &str = "VB-Audio Voicemeeter VAIO";

    fn ep(name: &str, interface: &str, flow: Flow, state: EndpointState) -> EndpointInfo {
        EndpointInfo {
            id: format!("{name}/{flow:?}"),
            name: name.into(),
            friendly: format!("{name} ({interface})"),
            interface: interface.into(),
            flow,
            state,
        }
    }

    /// The active endpoints `sessions_probe` printed on the build PC (Potato 3.1.3.0), in the
    /// order Windows listed them as far as it matters: the In 1–5 / Out A* decoys come first.
    fn build_pc() -> Vec<EndpointInfo> {
        use EndpointState::*;
        use Flow::*;
        let mut v = vec![
            ep("Out 1-2", "MOTU M Series", Render, Active),
            ep(
                "Line",
                "Voicemod Virtual Audio Device (WDM)",
                Render,
                Active,
            ),
            ep("In 1-2", "MOTU M Series", Capture, Active),
        ];
        for n in 1..=5 {
            v.push(ep(&format!("Voicemeeter In {n}"), VM, Render, Active));
            v.push(ep(&format!("Voicemeeter Out A{n}"), VM, Capture, Active));
        }
        for name in [
            "Voicemeeter VAIO3 Input",
            "Voicemeeter AUX Input",
            "Voicemeeter Input",
        ] {
            v.push(ep(name, VM, Render, Active));
        }
        for b in 1..=3 {
            v.push(ep(&format!("Voicemeeter Out B{b}"), VM, Capture, Active));
        }
        v
    }

    #[test]
    fn build_pc_maps_each_target_to_its_named_endpoint() {
        let eps = build_pc();
        let got: Vec<_> = Mapping::default()
            .resolve(&eps)
            .into_iter()
            .map(|(t, e)| (t, e.map(|e| e.name.as_str())))
            .collect();
        assert_eq!(
            got,
            [
                (SessionTarget::strip(5), Some("Voicemeeter Input")),
                (SessionTarget::strip(6), Some("Voicemeeter AUX Input")),
                (SessionTarget::strip(7), Some("Voicemeeter VAIO3 Input")),
                (SessionTarget::bus(5), Some("Voicemeeter Out B1")),
                (SessionTarget::bus(6), Some("Voicemeeter Out B2")),
                (SessionTarget::bus(7), Some("Voicemeeter Out B3")),
            ]
        );
    }

    #[test]
    fn decoys_on_the_shared_interface_map_to_nothing() {
        let m = Mapping::default();
        for e in build_pc() {
            if e.name.contains(" In ") || e.name.contains("Out A") {
                assert_eq!(m.target_for(&e), None, "{}", e.name);
            }
        }
    }

    #[test]
    fn flow_must_match() {
        let m = Mapping::default();
        let wrong = ep(
            "Voicemeeter Input",
            VM,
            Flow::Capture,
            EndpointState::Active,
        );
        assert_eq!(m.target_for(&wrong), None);
        let wrong = ep(
            "Voicemeeter Out B1",
            VM,
            Flow::Render,
            EndpointState::Active,
        );
        assert_eq!(m.target_for(&wrong), None);
    }

    #[test]
    fn defaults_need_a_voicemeeter_interface() {
        let m = Mapping::default();
        let renamed = ep(
            "Voicemeeter Input",
            "Realtek(R) Audio",
            Flow::Render,
            EndpointState::Active,
        );
        assert_eq!(m.target_for(&renamed), None);
        let ok = ep(
            "  voicemeeter input ",
            "vb-audio voicemeeter vaio",
            Flow::Render,
            EndpointState::Active,
        );
        assert_eq!(m.target_for(&ok), Some(SessionTarget::strip(5)));
    }

    #[test]
    fn inactive_endpoints_are_skipped() {
        let mut eps = build_pc();
        for e in &mut eps {
            if e.name == "Voicemeeter VAIO3 Input" {
                e.state = EndpointState::Disabled;
            }
        }
        let r = Mapping::default().resolve(&eps);
        assert!(r[2].1.is_none(), "strip 7");
        assert!(r[0].1.is_some());
        assert!(r[5].1.is_some(), "bus 7 is a different endpoint");
    }

    #[test]
    fn overrides_replace_one_target_and_match_any_device() {
        let m = Mapping::new(&[EndpointRule {
            target: SessionTarget::strip(7),
            endpoint: "Line".into(),
        }]);
        let line = ep(
            "Line",
            "Voicemod Virtual Audio Device (WDM)",
            Flow::Render,
            EndpointState::Active,
        );
        assert_eq!(m.target_for(&line), Some(SessionTarget::strip(7)));
        let vaio3 = ep(
            "Voicemeeter VAIO3 Input",
            VM,
            Flow::Render,
            EndpointState::Active,
        );
        assert_eq!(m.target_for(&vaio3), None);
        let b3 = ep(
            "Voicemeeter Out B3",
            VM,
            Flow::Capture,
            EndpointState::Active,
        );
        assert_eq!(m.target_for(&b3), Some(SessionTarget::bus(7)));
        // Blank overrides fall back to the default.
        let m = Mapping::new(&[EndpointRule {
            target: SessionTarget::strip(5),
            endpoint: "  ".into(),
        }]);
        assert_eq!(m, Mapping::default());
    }

    #[test]
    fn endpoint_name_falls_back_to_the_friendly_name() {
        assert_eq!(
            endpoint_name("Voicemeeter Input", "x", VM),
            "Voicemeeter Input"
        );
        assert_eq!(
            endpoint_name("", "Voicemeeter Out B2 (VB-Audio Voicemeeter VAIO)", VM),
            "Voicemeeter Out B2"
        );
        assert_eq!(endpoint_name("", "Speakers", "Other"), "Speakers");
    }

    #[test]
    fn rules_are_validated() {
        let ok = EndpointRule {
            target: SessionTarget::bus(6),
            endpoint: "x".into(),
        };
        assert!(validate_rules(std::slice::from_ref(&ok)).is_ok());
        assert!(
            validate_rules(&[EndpointRule {
                target: SessionTarget::strip(2),
                endpoint: "x".into()
            }])
            .is_err()
        );
        assert!(
            validate_rules(&[EndpointRule {
                target: SessionTarget::bus(6),
                endpoint: " ".into()
            }])
            .is_err()
        );
        assert!(validate_rules(&[ok.clone(), ok]).is_err());
    }

    #[test]
    fn non_targets_have_no_default() {
        assert_eq!(default_endpoint(SessionTarget::strip(0)), None);
        assert_eq!(default_endpoint(SessionTarget::bus(1)), None);
        assert!(TARGETS.iter().all(|t| default_endpoint(*t).is_some()));
    }
}
