//! The desktops' own undo (`undo` in `packages/runtime/src/desktops/actions.ts`, ADR 0117): the
//! last 20 windows moved to another desktop and desktops removed with their windows moved, taken
//! back last first. A move comes back while its window is still where it went; a removal only
//! while nothing changed since (the desktops, their layouts, pans and windows in use as it left
//! them). Closed windows' plugins are gone for the session, so a removal that closed them is not
//! kept. In memory, as the runtime kept it.

use std::collections::BTreeMap;

use serde_json::{Value, json};

use crate::desk::{Desk, InUse, Moved, OnRemove};
use crate::desktops::{Desktop, DesktopId, DesktopRef};
use crate::edits::Windows;
use crate::layout::DesktopLayout;
use crate::types::{Offset, Placement};

/// How many it keeps.
const DEPTH: usize = 20;

/// What a removal takes back: the desk's desktops as they were.
#[derive(Clone, Debug, PartialEq)]
struct Parts {
    session: BTreeMap<DesktopId, DesktopLayout>,
    desktops: Option<Vec<Desktop>>,
    pan: BTreeMap<DesktopId, Offset>,
    focus_by: BTreeMap<DesktopId, InUse>,
    desktop: DesktopId,
}

impl Parts {
    fn of(desk: &Desk) -> Parts {
        Parts {
            session: desk.session.clone(),
            desktops: desk.desktops.clone(),
            pan: desk.pan.clone(),
            focus_by: desk.focus_by.clone(),
            desktop: desk.here(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
enum Step {
    Move(Moved),
    Remove { before: Parts, after: Parts },
}

/// The stack, most recent last.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Undo {
    steps: Vec<Step>,
}

impl Undo {
    fn push(&mut self, step: Step) {
        self.steps.push(step);
        if self.steps.len() > DEPTH {
            self.steps.remove(0);
        }
    }

    /// Move `window` to `desktop` (`before`: where it was before a drag that ended there);
    /// whether it moved.
    pub fn move_to(
        &mut self,
        desk: &mut Desk,
        window: &str,
        desktop: DesktopRef,
        before: Option<&Placement>,
    ) -> bool {
        let Some(moved) = desk.move_to_desktop(window, desktop, before) else {
            return false;
        };
        self.push(Step::Move(moved));
        true
    }

    /// Remove `desktop`, its windows moved to its neighbour or closed: `{ name, closed }` with the
    /// plugins the closed windows showed (the runtime unmounts them), or null for the last one.
    pub fn remove(&mut self, desk: &mut Desk, desktop: DesktopRef, windows: Windows) -> Value {
        let before = Parts::of(desk);
        let id = desk.id_of(desktop.clone());
        let name = (desk.desktops().iter())
            .find(|d| d.id == id)
            .map_or_else(|| id.clone(), |d| d.name.clone());
        let Some(removal) = desk.remove_desktop(desktop, OnRemove::from(windows)) else {
            return Value::Null;
        };
        let mut closed: Vec<String> = Vec::new();
        for p in &removal.closed {
            for plugin in desk.plugins_of(p) {
                if !closed.contains(&plugin) {
                    closed.push(plugin);
                }
            }
        }
        // Closed windows' plugins unmount for the session, let go with the removal (`released`).
        for plugin in &closed {
            desk.release(plugin);
        }
        if windows == Windows::Move {
            let after = Parts::of(desk);
            self.push(Step::Remove { before, after });
        }
        json!({ "name": name, "closed": closed })
    }

    /// Take the last step back; whether there was one to take.
    pub fn undo(&mut self, desk: &mut Desk) -> bool {
        match self.steps.pop() {
            Some(Step::Move(moved)) => desk.move_back(&moved),
            Some(Step::Remove { before, after }) if Parts::of(desk) == after => {
                desk.set(|d| {
                    d.session = before.session;
                    d.desktops = before.desktops;
                    d.pan = before.pan;
                    d.focus_by = before.focus_by;
                    d.desktop = before.desktop;
                    d.focused = None;
                    d.pane = None;
                });
                true
            }
            _ => false,
        }
    }
}
