//! Moving a window to another desktop (ADR 0117; `packages/runtime/src/desktops/move.ts`): it
//! leaves one desktop's layout and joins the other's with the same size, panes and place on screen,
//! and it is the window in use there. What a move answers (`Moved`) takes it back.

use serde::{Deserialize, Serialize};

use crate::desktops::{DesktopId, DesktopRef, id_at};
use crate::types::Placement;

use super::{Desk, InUse};

/// One move, enough to take it back.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Moved {
    pub window: String,
    pub from: DesktopId,
    pub to: DesktopId,
    /// Where it was, on the first desktop's canvas.
    pub placement: Placement,
    /// It was a plugin window in its slot, on every desktop and in no layout.
    pub slotted: bool,
    /// It was the window in use.
    pub focused: bool,
}

impl Desk {
    /// The desktop that shows `window`: the one in front first, then the others in order.
    pub fn holder_of(&self, window: &str) -> Option<DesktopId> {
        let here = self.here();
        if self
            .windows_of(here.as_str())
            .iter()
            .any(|p| p.id == window)
        {
            return Some(here);
        }
        self.desktops()
            .iter()
            .find(|d| {
                self.layout_of(d.id.as_str())
                    .surfaces
                    .iter()
                    .any(|p| p.id == window)
            })
            .map(|d| d.id.clone())
    }

    /// `p` from desktop `from` drawn at the same place on `to`'s canvas: a normal window shifted
    /// by the two pans, a floating one as it is.
    pub fn on_screen(&self, p: &Placement, from: &str, to: &str) -> Placement {
        if p.floating == Some(true) {
            return p.clone();
        }
        let (a, b) = (self.pan_of(from), self.pan_of(to));
        Placement {
            x: p.x + a.x - b.x,
            y: p.y + a.y - b.y,
            ..p.clone()
        }
    }

    /// `window` out of `from`'s layout and, when given, `placement` last in `to`'s; without one,
    /// out of `to`'s too.
    fn relocate(&mut self, window: &str, from: &str, to: &str, placement: Option<Placement>) {
        let mut out = self.layout_of(from);
        if out.surfaces.iter().any(|p| p.id == window) {
            out.surfaces.retain(|p| p.id != window);
            self.session.insert(from.to_string(), out);
        }
        let mut into = self.layout_of(to);
        let there = into.surfaces.iter().any(|p| p.id == window);
        if placement.is_some() || there {
            into.surfaces.retain(|p| p.id != window);
            into.surfaces.extend(placement);
            self.session.insert(to.to_string(), into);
        }
    }

    /// Move `window` to desktop `to`, keeping its size, panes and place on screen; it is the window
    /// in use there, and the desk stays where it is. `before` is where it was before a drag that
    /// ended on a desktop: it lands there, not under the pointer. `None` with nothing to move.
    pub fn move_to_desktop(
        &mut self,
        window: &str,
        to: impl Into<DesktopRef>,
        before: Option<&Placement>,
    ) -> Option<Moved> {
        let from = self.holder_of(window)?;
        let target = id_at(self.desktops(), &to.into())?;
        if from == target {
            return None;
        }
        let shown = self
            .windows_of(from.as_str())
            .into_iter()
            .find(|p| p.id == window);
        let placed = self
            .layout_of(from.as_str())
            .surfaces
            .into_iter()
            .find(|p| p.id == window);
        let slotted = placed.is_none();
        let was = before.cloned().or(placed).or(shown)?;
        let here = self.here();
        let focused = self.focused.as_deref() == Some(window) && from == here;
        let pane = if focused {
            self.pane.clone()
        } else {
            self.focus_by
                .get(&from)
                .filter(|k| k.window == window)
                .and_then(|k| k.pane.clone())
        };
        let arriving = self.on_screen(&was, &from, &target);
        self.relocate(window, &from, &target, Some(arriving));
        // Who has the focus now.
        let left = self.focus_by.remove(&from);
        self.focus_by.remove(&target);
        if let Some(left) = left.filter(|k| k.window != window) {
            self.focus_by.insert(from.clone(), left);
        }
        if target == here {
            self.focused = Some(window.to_string());
            self.used.touch(window);
            self.pane = pane;
        } else {
            self.focus_by.insert(
                target.clone(),
                InUse {
                    window: window.to_string(),
                    pane,
                },
            );
            if from == here && self.focused.as_deref() == Some(window) {
                self.focused = None;
                self.pane = None;
            }
        }
        self.keep_away();
        Some(Moved {
            window: window.to_string(),
            from,
            to: target,
            placement: was,
            slotted,
            focused,
        })
    }

    /// Take a move back: the window returns where it was (a slotted one to its slot on every
    /// desktop), and is in use again if it was. False when there is nothing to take back: a
    /// desktop is gone, or the window left the one it went to.
    pub fn move_back(&mut self, moved: &Moved) -> bool {
        let list = self.desktops();
        let from = id_at(list, &moved.from.as_str().into());
        let to = id_at(list, &moved.to.as_str().into());
        if from.is_none() || to.is_none() {
            return false;
        }
        let there = self.layout_of(moved.to.as_str());
        if !there.surfaces.iter().any(|p| p.id == moved.window) {
            return false;
        }
        let back = (!moved.slotted).then(|| moved.placement.clone());
        self.relocate(&moved.window, &moved.to, &moved.from, back);
        let here = self.here();
        if let Some(kept) = self.focus_by.remove(&moved.to)
            && kept.window != moved.window
        {
            self.focus_by.insert(moved.to.clone(), kept);
        }
        if moved.focused && moved.from == here {
            self.focused = Some(moved.window.clone());
            self.used.touch(&moved.window);
        } else {
            if moved.focused {
                self.focus_by.insert(
                    moved.from.clone(),
                    InUse {
                        window: moved.window.clone(),
                        pane: None,
                    },
                );
            }
            if self.focused.as_deref() == Some(moved.window.as_str()) && moved.to == here {
                self.focused = None;
                self.pane = None;
            }
        }
        self.keep_away();
        true
    }
}
