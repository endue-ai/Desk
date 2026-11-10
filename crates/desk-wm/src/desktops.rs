//! Desktops as a named, open-ended list (ADR 0117; `packages/runtime/src/desktops/model.ts`): each
//! has a stable string id and a name, and its position in the list is its index. These are the
//! list's own operations, on plain lists; the `Desk` applies them (`desk/desktops.rs`).

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// No more desktops than this: past it the switcher and the overview stop being readable.
pub const MAX_DESKTOPS: usize = 32;
/// A name longer than this, in characters, is cut.
pub const NAME_LIMIT: usize = 40;

/// A desktop's stable id. The four a desk starts with are "1" to "4", as four-desktop data keys them.
pub type DesktopId = String;

/// One desktop: its id, which never changes, and the name the switcher shows.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Desktop {
    pub id: DesktopId,
    pub name: String,
}

/// A desktop by id, or by its position from 1 when a number (older callers and saved sessions).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DesktopRef {
    Id(DesktopId),
    Position(i64),
}

impl From<&str> for DesktopRef {
    fn from(id: &str) -> Self {
        DesktopRef::Id(id.to_string())
    }
}

impl From<String> for DesktopRef {
    fn from(id: String) -> Self {
        DesktopRef::Id(id)
    }
}

impl From<&String> for DesktopRef {
    fn from(id: &String) -> Self {
        DesktopRef::Id(id.clone())
    }
}

impl From<i32> for DesktopRef {
    fn from(position: i32) -> Self {
        DesktopRef::Position(i64::from(position))
    }
}

impl From<usize> for DesktopRef {
    fn from(position: usize) -> Self {
        DesktopRef::Position(i64::try_from(position).unwrap_or(i64::MAX))
    }
}

/// The four a desk starts with, named 1 to 4 as the four-desktop desk numbered them.
pub fn default_desktops() -> Vec<Desktop> {
    ["1", "2", "3", "4"]
        .map(|id| Desktop {
            id: id.into(),
            name: id.into(),
        })
        .into()
}

/// The id at a position (from 1), or the id itself when the list has it.
pub fn id_at(list: &[Desktop], r: &DesktopRef) -> Option<DesktopId> {
    match r {
        DesktopRef::Position(n) => usize::try_from(*n)
            .ok()
            .and_then(|n| n.checked_sub(1))
            .and_then(|i| list.get(i))
            .map(|d| d.id.clone()),
        DesktopRef::Id(id) => list.iter().any(|d| &d.id == id).then(|| id.clone()),
    }
}

/// A desktop's position, from 1; 0 when the list does not have it.
pub fn position_of(list: &[Desktop], id: &str) -> usize {
    list.iter().position(|d| d.id == id).map_or(0, |i| i + 1)
}

/// A name as it is kept: one line, trimmed, at most `NAME_LIMIT` characters.
pub fn clean_name(name: &str) -> String {
    let line = name.split_whitespace().collect::<Vec<_>>().join(" ");
    let cut: String = line.chars().take(NAME_LIMIT).collect();
    cut.trim().to_string()
}

/// An id no desktop has had: one more than the highest number among `taken` (the list's ids and
/// any a saved layout still uses), so a new desktop never inherits a removed one's windows.
pub fn next_id<S: AsRef<str>>(taken: impl IntoIterator<Item = S>) -> DesktopId {
    let highest = taken
        .into_iter()
        .filter_map(|id| {
            let id = id.as_ref();
            let digits = !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit());
            digits.then(|| id.parse::<u64>().unwrap_or(u64::MAX - 1))
        })
        .max()
        .unwrap_or(0);
    (highest + 1).to_string()
}

/// The first number no desktop in the list is named.
pub fn next_name(list: &[Desktop]) -> String {
    (1..)
        .map(|n: u64| n.to_string())
        .find(|n| !list.iter().any(|d| &d.name == n))
        .unwrap_or_default()
}

/// The list with a new desktop at the end and its id, or `None` at the cap. An empty or absent
/// name takes the first free number.
pub fn added<S: AsRef<str>>(
    list: &[Desktop],
    taken: impl IntoIterator<Item = S>,
    name: Option<&str>,
) -> Option<(Vec<Desktop>, DesktopId)> {
    if list.len() >= MAX_DESKTOPS {
        return None;
    }
    let mut all: Vec<String> = list.iter().map(|d| d.id.clone()).collect();
    all.extend(taken.into_iter().map(|t| t.as_ref().to_string()));
    let id = next_id(&all);
    let clean = name.map(clean_name).unwrap_or_default();
    let name = if clean.is_empty() {
        next_name(list)
    } else {
        clean
    };
    let mut next = list.to_vec();
    next.push(Desktop {
        id: id.clone(),
        name,
    });
    Some((next, id))
}

/// The list with one desktop renamed; an empty name leaves it as it was.
pub fn renamed(list: &[Desktop], id: &str, name: &str) -> Vec<Desktop> {
    let clean = clean_name(name);
    list.iter()
        .map(|d| {
            if d.id == id && !clean.is_empty() {
                Desktop {
                    id: d.id.clone(),
                    name: clean.clone(),
                }
            } else {
                d.clone()
            }
        })
        .collect()
}

/// The list without one desktop; the last one stays.
pub fn removed(list: &[Desktop], id: &str) -> Vec<Desktop> {
    if list.len() <= 1 {
        return list.to_vec();
    }
    list.iter().filter(|d| d.id != id).cloned().collect()
}

/// The list with one desktop moved to position `to` (from 1), clamped to the list.
pub fn moved(list: &[Desktop], id: &str, to: i64) -> Vec<Desktop> {
    let Some(from) = list.iter().position(|d| d.id == id) else {
        return list.to_vec();
    };
    let mut rest: Vec<Desktop> = list.iter().filter(|d| d.id != id).cloned().collect();
    let at = usize::try_from((to - 1).max(0))
        .unwrap_or(0)
        .min(rest.len());
    rest.insert(at, list[from].clone());
    rest
}

/// Where a removed desktop's windows go: the desktop before it, or after it when it is first.
pub fn neighbour_of(list: &[Desktop], id: &str) -> Option<DesktopId> {
    let at = list.iter().position(|d| d.id == id)?;
    at.checked_sub(1)
        .and_then(|i| list.get(i))
        .or_else(|| list.get(at + 1))
        .map(|d| d.id.clone())
}

/// The desktop `step` places after (before, when negative) `id`, round the list.
pub fn step_from(list: &[Desktop], id: &str, step: i64) -> DesktopId {
    if list.is_empty() {
        return id.to_string();
    }
    let at = list.iter().position(|d| d.id == id).unwrap_or(0) as i64;
    let n = list.len() as i64;
    let i = usize::try_from((at + step).rem_euclid(n)).unwrap_or(0);
    list[i].id.clone()
}

/// Whether two lists name the same desktops in the same order.
pub fn same_list(a: &[Desktop], b: &[Desktop]) -> bool {
    a == b
}

/// A list as stored, when it is one: unique non-empty ids, at least one desktop, at most the cap
/// (the rest are dropped). A missing or empty name is the id.
pub fn read_list(value: &Value) -> Option<Vec<Desktop>> {
    let entries = value.as_array().filter(|a| !a.is_empty())?;
    let mut out: Vec<Desktop> = Vec::new();
    for entry in entries.iter().take(MAX_DESKTOPS) {
        let entry = entry.as_object()?;
        let id = entry
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())?;
        if out.iter().any(|d| d.id == id) {
            return None;
        }
        let clean = entry
            .get("name")
            .and_then(Value::as_str)
            .map(clean_name)
            .unwrap_or_default();
        out.push(Desktop {
            id: id.to_string(),
            name: if clean.is_empty() {
                id.to_string()
            } else {
                clean
            },
        });
    }
    Some(out)
}
