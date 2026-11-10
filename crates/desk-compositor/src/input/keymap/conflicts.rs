//! The conflict resolver (ADR 0118, `sequences/conflicts.ts`): every binding of every layer goes in;
//! out come the bindings in force and every conflict, so no binding is dropped without a word.
//! Precedence is personal > plugin > core default, and within a layer the later binding wins. Two
//! bindings conflict when they have the same sequence (a duplicate) or one is a prefix of the other
//! (shadowing). A reserved chord is reported too. `"command": ""` takes a sequence away from lower
//! layers; that is intended, not a conflict.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::chord::Platform;
use super::parse::{canonical, chords_of, is_prefix};
use super::reserved::{Reserved, reserved_chords, reserved_in};

/// Where a binding is written, so people can find it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeySource {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// A binding as a layer has it, with the plugin (or `desk`, or `person`) it comes from: the
/// runtime's `KeyEntry`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct KeyEntry {
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mac: Option<String>,
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Value>,
    pub owner: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<KeySource>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum KeyLayer {
    Default,
    Plugin,
    Personal,
}

/// The layer of an owner: the person's, the desk's own defaults, or a plugin's.
pub fn layer_of(owner: &str) -> KeyLayer {
    match owner {
        "person" => KeyLayer::Personal,
        "desk" => KeyLayer::Default,
        _ => KeyLayer::Plugin,
    }
}

/// A binding read for a platform.
#[derive(Clone, Debug, PartialEq)]
pub struct Resolved {
    /// The canonical sequence: "Meta+K Meta+S".
    pub combo: String,
    pub chords: Vec<String>,
    pub command: String,
    pub args: Option<Value>,
    pub owner: String,
    pub layer: KeyLayer,
    /// The entry's place among the ones resolved.
    pub index: usize,
    pub source: Option<KeySource>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConflictKind {
    Duplicate,
    Shadowed,
    Reserved,
}

/// Error: it can never run; warning: a layer is at odds with itself, or the system has the chord;
/// info: a higher layer won, as precedence says.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
    Info,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Conflict {
    pub kind: ConflictKind,
    pub severity: Severity,
    /// The binding that loses, or the one that holds a reserved chord.
    pub binding: Resolved,
    /// The binding in force that beats it.
    pub by: Option<Resolved>,
    pub reserved: Option<Reserved>,
    /// Whether `binding` is in force all the same (a reserved chord stays bound).
    pub bound: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Resolution {
    /// The bindings in force, in sequence order.
    pub bindings: Vec<Resolved>,
    pub conflicts: Vec<Conflict>,
    /// Bindings a higher `"command": ""` took away.
    pub removed: Vec<Resolved>,
}

fn rank(binding: &Resolved) -> (KeyLayer, usize) {
    (binding.layer, binding.index)
}

fn order(a: &Resolved, b: &Resolved) -> std::cmp::Ordering {
    a.combo.cmp(&b.combo).then(a.index.cmp(&b.index))
}

/// The bindings of every layer, resolved for a platform.
pub fn resolve_bindings(entries: &[KeyEntry], platform: Platform) -> Resolution {
    let reserved = reserved_chords(platform);
    let mut all: Vec<Resolved> = entries
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            let written = match (platform, &entry.mac) {
                (Platform::Mac, Some(mac)) => mac.as_str(),
                _ => entry.key.as_str(),
            };
            let combo = canonical(written, platform);
            Resolved {
                chords: chords_of(&combo),
                combo,
                command: entry.command.clone(),
                args: entry.args.clone(),
                owner: entry.owner.clone(),
                layer: layer_of(&entry.owner),
                index,
                source: entry.source.clone(),
            }
        })
        .collect();
    // Highest precedence first: the person's last binding, down to the first core default.
    all.sort_by_key(|b| std::cmp::Reverse(rank(b)));
    let mut taken: Vec<Resolved> = Vec::new();
    let mut by_combo: HashMap<String, usize> = HashMap::new();
    let mut unbound: HashSet<String> = HashSet::new();
    let mut resolution = Resolution::default();
    let severity = |loser: &Resolved, winner: &Resolved| {
        if loser.layer == winner.layer {
            Severity::Warning
        } else {
            Severity::Info
        }
    };
    for binding in all {
        if binding.command.is_empty() {
            if !by_combo.contains_key(&binding.combo) {
                unbound.insert(binding.combo.clone());
            }
            continue;
        }
        if unbound.contains(&binding.combo) {
            resolution.removed.push(binding);
            continue;
        }
        let held = reserved_in(&binding.chords, &reserved);
        if let Some(held) = held.clone().filter(|r| r.never) {
            resolution.conflicts.push(Conflict {
                kind: ConflictKind::Reserved,
                severity: Severity::Error,
                binding,
                by: None,
                reserved: Some(held),
                bound: false,
            });
            continue;
        }
        let same = by_combo.get(&binding.combo).map(|i| taken[*i].clone());
        let shadow = || {
            taken
                .iter()
                .find(|other| {
                    is_prefix(&other.chords, &binding.chords)
                        || is_prefix(&binding.chords, &other.chords)
                })
                .cloned()
        };
        let (kind, by) = match same {
            Some(same) => (ConflictKind::Duplicate, Some(same)),
            None => (ConflictKind::Shadowed, shadow()),
        };
        if let Some(by) = by {
            resolution.conflicts.push(Conflict {
                kind,
                severity: severity(&binding, &by),
                binding,
                by: Some(by),
                reserved: None,
                bound: false,
            });
            continue;
        }
        by_combo.insert(binding.combo.clone(), taken.len());
        if let Some(held) = held {
            resolution.conflicts.push(Conflict {
                kind: ConflictKind::Reserved,
                severity: Severity::Warning,
                binding: binding.clone(),
                by: None,
                reserved: Some(held),
                bound: true,
            });
        }
        taken.push(binding);
    }
    taken.sort_by(order);
    resolution.bindings = taken;
    resolution
        .conflicts
        .sort_by(|a, b| order(&a.binding, &b.binding));
    resolution.removed.sort_by(order);
    resolution
}

/// The bindings in force under a prefix (every continuation), in sequence order.
pub fn continuations<'a, S: AsRef<str>>(
    bindings: &'a [Resolved],
    prefix: &[S],
) -> Vec<&'a Resolved> {
    bindings
        .iter()
        .filter(|binding| is_prefix(prefix, &binding.chords))
        .collect()
}
