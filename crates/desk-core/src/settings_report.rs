//! Reporting setting values that fail (ADR 0080). The core reads every place a value is written:
//! init.yaml, the saved profiles in `~/.desk/profiles`, the profiles plugins contribute in their
//! plugin.json, and the set values. It logs each problem once per run, with its file and line, and
//! sends `settings.invalid` for a value that fell back to the setting's owner and to desk; init.get
//! from desk sends every one in force again, so a runtime that starts after the core hears them all.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use desk_bridge::{BridgeEvent, InvalidSetting, LogLevel, SettingsInvalidEvent};
use serde_json::{Map, Value, json};

use crate::core_init::bridge_path;
use crate::handler::Core;
use crate::init::{Step, line_of};
use crate::settings_check::{Schemas, problem};
use crate::sync::lock;

/// The caller that tells the person: the runtime.
const DESK: &str = "desk";

/// A setting value that fails its declaration, or a name that does not resolve, and where it is.
#[derive(Debug, Clone, PartialEq)]
pub struct SettingProblem {
    /// The setting's owner and key; for an unknown name, the plugin it falls under and the rest.
    pub owner: String,
    pub key: String,
    /// The name as written.
    pub name: String,
    pub value: Value,
    pub layer: Layer,
    /// The file it is written in, `~/...` inside the home folder.
    pub file: Option<String>,
    /// The line of its name in the file, from 1.
    pub line: Option<u64>,
    pub kind: ProblemKind,
}

/// Where a value comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Layer {
    Init,
    Profile,
    Set,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ProblemKind {
    /// The value fails its setting and the layer below is in force; `fallback` says what that is.
    Invalid { reason: String, fallback: String },
    /// The owner declares no such setting.
    Unknown { nearest: Option<String> },
    /// The name is an earlier name of `to`; `shadowed` when `to` is written in the same place too.
    Renamed { to: String, shadowed: bool },
}

impl fmt::Display for SettingProblem {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        let place = match self.layer {
            Layer::Init => "init.yaml",
            Layer::Profile => "a profile",
            Layer::Set => "settings.set",
        };
        write!(f, "{}", self.file.as_deref().unwrap_or(place))?;
        if let Some(line) = self.line {
            write!(f, ":{line}")?;
        }
        write!(f, ": {}: ", self.name)?;
        let (owner, key) = (&self.owner, &self.key);
        match &self.kind {
            ProblemKind::Invalid { reason, fallback } => write!(f, "{reason}; {fallback}"),
            ProblemKind::Unknown {
                nearest: Some(nearest),
            } => {
                write!(f, "{owner} has no setting {key}; did you mean {nearest}?")
            }
            ProblemKind::Unknown { nearest: None } => write!(f, "{owner} has no setting {key}"),
            ProblemKind::Renamed {
                to,
                shadowed: false,
            } => {
                write!(f, "renamed to {to}; the value is read from the old name")
            }
            ProblemKind::Renamed { to, shadowed: true } => {
                write!(
                    f,
                    "renamed to {to}, which is written too; this value is ignored"
                )
            }
        }
    }
}

impl Core {
    /// Every problem the settings hold now. New ones are logged and sent as they are found; the app
    /// prints them all at start.
    pub fn settings_problems(&self) -> Vec<SettingProblem> {
        self.report_settings(false)
    }

    /// Find the problems, log and send the ones not seen before, and with `resend` send desk every
    /// value that fell back again.
    pub(crate) fn report_settings(&self, resend: bool) -> Vec<SettingProblem> {
        let problems = self.find_problems();
        let ids: BTreeSet<String> = problems.iter().map(identity).collect();
        let fresh: Vec<bool> = {
            let mut reported = lock(&self.settings_reported);
            let fresh = problems.iter().map(|p| reported.insert(identity(p)));
            let fresh = fresh.collect();
            reported.retain(|id| ids.contains(id));
            fresh
        };
        for (problem, fresh) in problems.iter().zip(fresh) {
            if fresh {
                let level = match problem.kind {
                    ProblemKind::Renamed { .. } => LogLevel::Info,
                    _ => LogLevel::Warn,
                };
                self.log(level, problem.to_string(), Some(fields(problem)));
            }
            let to = match (fresh, resend) {
                (true, _) => vec![problem.owner.clone(), DESK.to_owned()],
                (false, true) => vec![DESK.to_owned()],
                (false, false) => continue,
            };
            if let Some(event) = invalid_event(problem) {
                self.events().publish_to(to, event);
            }
        }
        problems
    }

    fn find_problems(&self) -> Vec<SettingProblem> {
        let plugins = self.plugins();
        let schemas = Schemas::new(&plugins);
        let home = self.home().to_path_buf();
        let place = |path: &Path| Some(bridge_path(path, &home));
        let mut found = Vec::new();

        let (settings, path, text) = {
            let file = self.init_file();
            let text = file.read().unwrap_or_default();
            (
                file.init().settings.clone(),
                file.path().and_then(place),
                text,
            )
        };
        let init = Place {
            schemas: &schemas,
            layer: Layer::Init,
            file: path,
            text: &text,
        };
        init.check(&settings, None, &mut found);

        for path in yaml_files(&home.join(".desk/profiles")) {
            let text = fs::read_to_string(&path).unwrap_or_default();
            let document: Option<Value> = yaml_serde::from_str(&text).ok();
            let Some(Value::Object(settings)) = document.and_then(|d| d.get("settings").cloned())
            else {
                continue;
            };
            let settings: BTreeMap<String, Value> = settings.into_iter().collect();
            let file = place(&path);
            let saved = Place {
                schemas: &schemas,
                layer: Layer::Profile,
                file,
                text: &text,
            };
            saved.check(&settings, None, &mut found);
        }

        for (id, dir) in self.plugin_folders() {
            let manifest = plugins
                .iter()
                .find(|p| p.id == id)
                .and_then(|p| p.manifest.as_ref());
            let profiles = manifest.and_then(|m| m.contributes.as_ref()?.profiles.as_ref());
            let Some(profiles) = profiles.filter(|p| p.iter().any(|p| p.settings.is_some())) else {
                continue;
            };
            let path = dir.join("plugin.json");
            let text = fs::read_to_string(&path).unwrap_or_default();
            let file = place(&path);
            let contributed = Place {
                schemas: &schemas,
                layer: Layer::Profile,
                file,
                text: &text,
            };
            for (index, profile) in profiles.iter().enumerate() {
                let settings = profile.settings.clone().unwrap_or_default();
                contributed.check(&settings, Some(index), &mut found);
            }
        }

        // A set value is its owner's: a name another plugin declares is not checked against that.
        let set: BTreeMap<String, Value> = self
            .set_values()
            .all()
            .map(|(owner, key, value)| (owner, format!("{owner}.{key}"), value.clone()))
            .filter(|(owner, name, _)| schemas.named(name).is_none_or(|d| d.owner == *owner))
            .map(|(_, name, value)| (name, value))
            .collect();
        let set_place = Place {
            schemas: &schemas,
            layer: Layer::Set,
            file: None,
            text: "",
        };
        set_place.check(&set, None, &mut found);
        found
    }
}

/// One place values are written in, and the declarations they are checked against.
struct Place<'a> {
    schemas: &'a Schemas,
    layer: Layer,
    file: Option<String>,
    text: &'a str,
}

impl Place<'_> {
    /// Check `settings` (full name → value), the `profile`-th contributed profile's when given; what
    /// fails goes to `out` in line order.
    fn check(
        &self,
        settings: &BTreeMap<String, Value>,
        profile: Option<usize>,
        out: &mut Vec<SettingProblem>,
    ) {
        let start = out.len();
        for (name, value) in settings {
            let line = || match profile {
                None if self.layer == Layer::Set => None,
                None => line_of(self.text, &[Step::Key("settings"), Step::Key(name)]),
                Some(index) => line_of(
                    self.text,
                    &[
                        Step::Key("contributes"),
                        Step::Key("profiles"),
                        Step::Index(index),
                    ]
                    .into_iter()
                    .chain([Step::Key("settings"), Step::Key(name)])
                    .collect::<Vec<_>>(),
                ),
            };
            let problem_at = |owner: &str, key: &str, kind| SettingProblem {
                owner: owner.to_owned(),
                key: key.to_owned(),
                name: name.clone(),
                value: value.clone(),
                layer: self.layer,
                file: self.file.clone(),
                line: line(),
                kind,
            };
            if let Some(declared) = self.schemas.named(name) {
                if let Some(reason) = problem(&declared.setting, value) {
                    let fallback = self.fallback(&declared.setting.default);
                    let kind = ProblemKind::Invalid { reason, fallback };
                    out.push(problem_at(&declared.owner, &declared.key, kind));
                }
            } else if let Some(declared) = self.schemas.renamed_to(name) {
                let first = declared
                    .names()
                    .into_iter()
                    .find(|n| settings.contains_key(n));
                let shadowed = first.as_deref() != Some(name.as_str());
                if self.layer != Layer::Set {
                    let kind = ProblemKind::Renamed {
                        to: declared.name(),
                        shadowed,
                    };
                    out.push(problem_at(&declared.owner, &declared.key, kind));
                }
                if let (false, Some(reason)) = (shadowed, problem(&declared.setting, value)) {
                    let fallback = self.fallback(&declared.setting.default);
                    let kind = ProblemKind::Invalid { reason, fallback };
                    out.push(problem_at(&declared.owner, &declared.key, kind));
                }
            } else if self.layer != Layer::Set
                && let Some((owner, key, true)) = self.schemas.owner_of(name)
            {
                let nearest = self.schemas.nearest(owner, name);
                out.push(problem_at(owner, key, ProblemKind::Unknown { nearest }));
            }
        }
        // People read a file top to bottom.
        out[start..].sort_by_key(|problem| problem.line);
    }

    /// What is in force instead of a value of this place that fails.
    fn fallback(&self, default: &Value) -> String {
        match self.layer {
            Layer::Init => format!("the default {default} is used"),
            Layer::Profile => "the profile leaves the setting as it was".to_owned(),
            Layer::Set => {
                format!("the set value is ignored; init.yaml's or the default {default} is used")
            }
        }
    }
}

/// The `.yaml` files in `dir`, by name.
fn yaml_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .map(|read| read.flatten().map(|entry| entry.path()).collect())
        .unwrap_or_default();
    files.retain(|path| path.extension().is_some_and(|e| e == "yaml") && path.is_file());
    files.sort();
    files
}

/// What makes a problem the same one across reports.
fn identity(problem: &SettingProblem) -> String {
    format!("{problem}\u{1}{}", problem.value)
}

/// The log entry's fields: owner, key, name, value, file and line, and what is wrong.
fn fields(problem: &SettingProblem) -> Map<String, Value> {
    let mut fields = json!({ "owner": problem.owner, "key": problem.key, "name": problem.name,
        "value": problem.value });
    if let Some(file) = &problem.file {
        fields["file"] = json!(file);
    }
    if let Some(line) = problem.line {
        fields["line"] = json!(line);
    }
    match &problem.kind {
        ProblemKind::Invalid { reason, .. } => fields["reason"] = json!(reason),
        ProblemKind::Unknown { nearest } => fields["nearest"] = json!(nearest),
        ProblemKind::Renamed { to, .. } => fields["renamedTo"] = json!(to),
    }
    match fields {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}

fn invalid_event(problem: &SettingProblem) -> Option<BridgeEvent> {
    let ProblemKind::Invalid { reason, .. } = &problem.kind else {
        return None;
    };
    Some(BridgeEvent::SettingsInvalid(SettingsInvalidEvent {
        event: Default::default(),
        data: InvalidSetting {
            owner: problem.owner.clone(),
            key: problem.key.clone(),
            value: problem.value.clone(),
            reason: reason.clone(),
            file: problem.file.clone(),
            line: problem.line,
        },
    }))
}
