//! The records over the `Desk` (`switched`, `movedOf`, `revert` in
//! `packages/runtime/src/shell/actions.ts`; `syncProfiles`, `keepShell` and its restore in
//! `shell/link.ts`): the profile in force laid out again, what `desk.shell.layouts`' session layer
//! holds, putting the moved desktops back, and the session record restored at start. The records
//! stay the runtime's (settings, `desk.session`); it hands their JSON over, and reads what the
//! window manager publishes to write them back (`View::moved`).

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::desktops::{DesktopId, id_at, position_of};
use crate::drawer::DrawerItem;
use crate::layout::Saved;
use crate::migrate::{read_current, read_moved, read_pan};
use crate::tiling::free_slot;
use crate::types::{Adopted, Offset};

use super::Desk;

/// A drawer item saved with a time below this was dated by a clock, not the wall: it is dated now.
const WALL: i64 = 1_000_000_000_000;

/// A window's slot and the pan it arrived at, as the session saved them.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Slot {
    slot: usize,
    at: Option<Offset>,
}

impl Desk {
    /// The desktop to stay on once the list is `list`: the same one when it is there, else the one
    /// at the same position (or the last).
    fn stay_on(&self, list: &[crate::desktops::Desktop]) -> DesktopId {
        let here = self.here();
        let position = position_of(self.desktops(), &here);
        id_at(list, &here.as_str().into())
            .or_else(|| id_at(list, &position.min(list.len()).into()))
            .unwrap_or(here)
    }

    /// The profile in force was laid out again: `saved` is what it saves now. The session's moves
    /// stay; a list the person changed that is the profile's own again is the profile's.
    pub fn lay_out(&mut self, saved: Saved) {
        let list = self.desktops.clone().unwrap_or_else(|| saved.list.clone());
        self.desktop = self.stay_on(&list);
        if self.desktops.as_ref() == Some(&saved.list) {
            self.desktops = None;
        }
        self.saved = saved;
        self.keep_away();
    }

    /// What `desk.shell.layouts`' session layer holds now (`value`, `null` for nothing): the
    /// layouts moved, and the list when it is not the profile's own. The desk stays on its desktop
    /// when the list has it.
    pub fn take_moved(&mut self, value: &Value) {
        let moved = read_moved(value);
        let list = moved.list.filter(|l| l != &self.saved.list);
        let next = list.clone().unwrap_or_else(|| self.saved.list.clone());
        let here = self.here();
        self.session = moved.layouts;
        self.desktops = list;
        if !next.iter().any(|d| d.id == here) {
            self.desktop = next.first().map_or(here, |d| d.id.clone());
        }
        self.keep_away();
    }

    /// Put the moved desktops back as the profile saved them, and its list.
    pub fn revert(&mut self) {
        let list = self.saved.list.clone();
        let here = self.here();
        self.desktop = id_at(&list, &here.as_str().into())
            .or_else(|| list.first().map(|d| d.id.clone()))
            .unwrap_or(here);
        self.session.clear();
        self.desktops = None;
        self.keep_away();
    }

    /// The session record as it was saved: the desktop in front (an id, or a position before ADR
    /// 0117), each desktop's pan, the drawer (items dated by a clock dated `now`) and the plugin
    /// windows' slots, so each comes back on the slot and at the pan it had (#76).
    pub fn restore_session(
        &mut self,
        desktop: &Value,
        pan: &Value,
        drawer: &Value,
        slots: &Value,
        now: i64,
    ) {
        let list = self.desktops().to_vec();
        if let Some(id) = read_current(desktop, &list) {
            self.desktop = id;
        }
        let pans = read_pan(pan);
        self.pan = list
            .iter()
            .filter_map(|d| pans.get(&d.id).map(|p| (d.id.clone(), *p)))
            .collect();
        if let Some(items) = drawer.as_array() {
            self.drawer = items.iter().filter_map(|d| drawer_item(d, now)).collect();
        }
        self.adopted = slotted(&self.adopted, &slots_of(slots));
        self.keep_away();
    }
}

/// A drawer item as a session saved it, if it reads as one: its time in whole milliseconds, one
/// dated by a clock (before wall-clock ages) dated `now`.
fn drawer_item(value: &Value, now: i64) -> Option<DrawerItem> {
    let at = value.get("at")?.as_f64().filter(|v| v.is_finite())?;
    let mut item = value.clone();
    let whole = at.round() as i64;
    item["at"] = Value::from(if whole < WALL { now } else { whole });
    serde_json::from_value(item).ok()
}

/// The saved slots that can be read: a whole slot from 0, and a pan of two numbers if any.
fn slots_of(value: &Value) -> BTreeMap<String, Slot> {
    let mut slots = BTreeMap::new();
    let Some(map) = value.as_object() else {
        return slots;
    };
    for (id, saved) in map {
        let Some(slot) = saved.get("slot").and_then(Value::as_u64) else {
            continue;
        };
        let at = saved.get("at").and_then(|at| {
            let x = at.get("x")?.as_f64().filter(|v| v.is_finite())?;
            let y = at.get("y")?.as_f64().filter(|v| v.is_finite())?;
            Some(Offset::new(x, y))
        });
        let slot = usize::try_from(slot).unwrap_or(usize::MAX);
        slots.insert(id.clone(), Slot { slot, at });
    }
    slots
}

/// The windows back on the slot and at the pan they had (#76): at start the plugins mount in their
/// own order, each on the first slot left free. A window the save did not hold keeps its slot, or
/// takes a free one when a window that came back had it.
fn slotted(adopted: &[Adopted], slots: &BTreeMap<String, Slot>) -> Vec<Adopted> {
    if slots.is_empty() {
        return adopted.to_vec();
    }
    let mut taken: BTreeSet<usize> = adopted
        .iter()
        .filter_map(|a| slots.get(&a.id).map(|s| s.slot))
        .collect();
    adopted
        .iter()
        .enumerate()
        .map(|(i, a)| {
            if let Some(kept) = slots.get(&a.id) {
                return Adopted {
                    slot: Some(kept.slot),
                    at: kept.at,
                    ..a.clone()
                };
            }
            let slot = a.slot.unwrap_or(i);
            let free = if taken.contains(&slot) {
                free_slot(taken.iter().copied())
            } else {
                slot
            };
            taken.insert(free);
            Adopted {
                slot: Some(free),
                ..a.clone()
            }
        })
        .collect()
}
