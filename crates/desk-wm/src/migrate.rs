//! The desktops as profiles and sessions keep them (ADR 0117; `packages/runtime/src/desktops/
//! migrate.ts`): a `desktops` list, each entry with its `id`, `name` and `layout`. What the
//! four-desktop desk saved loads unchanged, with no step to run: it kept layouts by desktop
//! number, and the numbers are the ids of the four a desk starts with. Values are read leniently,
//! as the runtime reads them: what is not a list, a layout or a pan is left out.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::desktops::{Desktop, DesktopId, DesktopRef, id_at, read_list};
use crate::layout::DesktopLayout;
use crate::types::Offset;

/// What a stored value says: the list, when it names one, and the layouts it holds, by id.
#[derive(Clone, Debug, PartialEq)]
pub struct Stored<L> {
    pub list: Option<Vec<Desktop>>,
    pub layouts: BTreeMap<DesktopId, L>,
}

impl<L> Stored<L> {
    fn empty() -> Self {
        Self {
            list: None,
            layouts: BTreeMap::new(),
        }
    }
}

/// One desktop as it is stored, with its layout when it has one.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StoredDesktop<L> {
    pub id: DesktopId,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<L>,
}

/// What `desk.shell.layouts` holds for a changed list and the layouts moved on it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StoredMoved {
    pub desktops: Vec<StoredDesktop<DesktopLayout>>,
}

/// A partial layout, as a recipe keeps one over its `desktop`: the profiles layer it.
pub type PartialLayout = Map<String, Value>;

fn partial(value: &Value) -> Option<PartialLayout> {
    value.as_object().cloned()
}

/// A whole layout, as a session keeps one: an object with its surfaces.
fn whole(value: &Value) -> Option<DesktopLayout> {
    value.get("surfaces").filter(|s| s.is_array())?;
    serde_json::from_value(value.clone()).ok()
}

fn from_list<L>(entries: &Value, keep: impl Fn(&Value) -> Option<L>) -> Stored<L> {
    let Some(list) = read_list(entries) else {
        return Stored::empty();
    };
    let mut layouts = BTreeMap::new();
    for entry in entries.as_array().into_iter().flatten() {
        let id = entry.get("id").and_then(Value::as_str);
        let layout = entry.get("layout").and_then(&keep);
        if let (Some(id), Some(layout)) = (id, layout)
            && list.iter().any(|d| d.id == id)
        {
            layouts.insert(id.to_string(), layout);
        }
    }
    Stored {
        list: Some(list),
        layouts,
    }
}

fn by_number<L>(value: &Map<String, Value>, keep: impl Fn(&Value) -> Option<L>) -> Stored<L> {
    let layouts = value
        .iter()
        .filter_map(|(id, layout)| keep(layout).map(|l| (id.clone(), l)))
        .collect();
    Stored {
        list: None,
        layouts,
    }
}

/// `desk.shell.mode`'s `desktops`: the list, or (before ADR 0117) partial layouts by number.
pub fn read_recipe(value: &Value) -> Stored<PartialLayout> {
    match value {
        Value::Array(_) => from_list(value, partial),
        Value::Object(map) => by_number(map, partial),
        _ => Stored::empty(),
    }
}

/// `desk.shell.layouts`: `{ "desktops": [...] }`, or (before ADR 0117) whole layouts by number.
pub fn read_moved(value: &Value) -> Stored<DesktopLayout> {
    let Some(map) = value.as_object() else {
        return Stored::empty();
    };
    match map.get("desktops") {
        Some(list @ Value::Array(_)) => from_list(list, whole),
        _ => by_number(map, whole),
    }
}

/// The list as it is stored, each desktop with its layout when it has one.
pub fn write_list<L: Clone>(
    list: &[Desktop],
    layouts: &BTreeMap<DesktopId, L>,
) -> Vec<StoredDesktop<L>> {
    list.iter()
        .map(|d| StoredDesktop {
            id: d.id.clone(),
            name: d.name.clone(),
            layout: layouts.get(&d.id).cloned(),
        })
        .collect()
}

/// What `desk.shell.layouts` holds for a changed list and the layouts moved on it.
pub fn write_moved(list: &[Desktop], layouts: &BTreeMap<DesktopId, DesktopLayout>) -> StoredMoved {
    StoredMoved {
        desktops: write_list(list, layouts),
    }
}

/// A saved pan per desktop, by id; four-desktop sessions keyed it by number, the same ids. A pan
/// whose numbers are not finite (JSON writes a NaN as `null`) is left out.
pub fn read_pan(value: &Value) -> BTreeMap<DesktopId, Offset> {
    let Some(map) = value.as_object() else {
        return BTreeMap::new();
    };
    map.iter()
        .filter_map(|(id, pan)| {
            let x = pan.get("x")?.as_f64().filter(|v| v.is_finite())?;
            let y = pan.get("y")?.as_f64().filter(|v| v.is_finite())?;
            Some((id.clone(), Offset::new(x, y)))
        })
        .collect()
}

/// The desktop a session was on: its id, or (before ADR 0117) its number, a position.
pub fn read_current(value: &Value, list: &[Desktop]) -> Option<DesktopId> {
    let r = match value {
        Value::String(id) => DesktopRef::Id(id.clone()),
        // A number that is not a whole one names no position.
        Value::Number(n) => DesktopRef::Position(n.as_f64().filter(|v| v.fract() == 0.0)? as i64),
        _ => return None,
    };
    id_at(list, &r)
}
