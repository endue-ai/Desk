//! Session edits of a desktop's layout, opening windows and switching desktops (`edit`,
//! `ensurePlaced`, `moveSurface`, `togglePin`, `openSurface`, `inView`, `defaultPlacement`,
//! `setDesktop` in `packages/runtime/src/shell/actions.ts`; `switchTo` and `step` in
//! `desktops/actions.ts`). Every change to a layout is an unsaved session edit: the profile shows
//! its "changed" dot until it is saved or reverted.

use crate::desktops::{DesktopRef, id_at, step_from};
use crate::layout::DesktopLayout;
use crate::tiling::free_slot;
use crate::types::{Adopted, Offset, Placement, Rect};

use super::{Desk, InUse};

/// Where a window opened at the same spot as another goes instead: this much down and right.
const STEP: f64 = 24.0;

/// Where a window of view `id` opens by default, in the 1440×900 reference frame. The centre stays
/// free unless the person moves things.
pub fn default_placement(id: &str) -> Placement {
    let (plugin, rect) = if id == "calendar" {
        ("endue.calendar", Rect::new(120.0, 240.0, 560.0, 400.0))
    } else if id == "tomorrow" {
        ("endue.eris", Rect::new(1000.0, 220.0, 320.0, 360.0))
    } else if id == "notes" {
        ("endue.notes", Rect::new(140.0, 260.0, 380.0, 300.0))
    } else if id.starts_with("agent:") {
        ("endue.agent", Rect::new(520.0, 260.0, 400.0, 340.0))
    } else if id.starts_with("local:") {
        ("desk.agents", Rect::new(360.0, 120.0, 820.0, 600.0))
    } else if id.starts_with("endue-agent:") {
        // An endue agent's or space's card, tall enough for its Studio side, clear of Eris (ADR 0129).
        ("endue.agent", Rect::new(200.0, 110.0, 440.0, 600.0))
    } else if id.starts_with("endue-space:") {
        ("endue.space", Rect::new(180.0, 100.0, 480.0, 640.0))
    } else if id == "keys" {
        ("endue.keys", Rect::new(480.0, 200.0, 480.0, 440.0))
    } else if id.starts_with("recent:") {
        ("endue.eris", Rect::new(980.0, 300.0, 320.0, 240.0))
    } else {
        ("endue.files", Rect::new(980.0, 320.0, 320.0, 240.0))
    };
    Placement::new(id, plugin, rect)
}

/// A place no other window takes at exactly the same spot: the next one steps down and right.
fn cascade(mut p: Placement, others: &[Placement]) -> Placement {
    while others.iter().any(|o| o.x == p.x && o.y == p.y) {
        p.x += STEP;
        p.y += STEP;
    }
    p
}

impl Desk {
    /// Change the layout of the desktop in front as an unsaved session edit.
    pub fn edit(&mut self, change: impl FnOnce(&mut DesktopLayout)) {
        self.edit_at(self.here(), change);
    }

    /// Change one desktop's layout as an unsaved session edit.
    pub fn edit_at(&mut self, r: impl Into<DesktopRef>, change: impl FnOnce(&mut DesktopLayout)) {
        let id = self.id_of(r);
        let mut layout = self.layout_of(id.as_str());
        change(&mut layout);
        self.session.insert(id, layout);
        self.keep_away();
    }

    /// A plugin window in its slot enters the layout as it is, before an edit (a move, a pin, a
    /// split): from then on it lives on this desktop (ADR 0040, ADR 0117).
    pub fn ensure_placed(&mut self, id: &str) {
        if self.layout().surfaces.iter().any(|p| p.id == id) {
            return;
        }
        if let Some(slotted) = self
            .auto_placements(self.here())
            .into_iter()
            .find(|p| p.id == id)
        {
            self.edit(|l| l.surfaces.push(slotted));
        }
    }

    /// Change one window of the desktop in front, placing it first when it sat in its slot.
    pub fn update(&mut self, id: &str, change: impl FnOnce(&mut Placement)) {
        self.ensure_placed(id);
        self.edit(|l| {
            if let Some(p) = l.surfaces.iter_mut().find(|p| p.id == id) {
                change(p);
            }
        });
    }

    /// Move a window to `at`, in the coordinates of its mode.
    pub fn move_surface(&mut self, id: &str, at: Offset) {
        self.update(id, |p| {
            p.x = at.x;
            p.y = at.y;
        });
    }

    /// Move and resize a window to `rect`, in the coordinates of its mode.
    pub fn place(&mut self, id: &str, rect: Rect) {
        self.update(id, |p| p.set_rect(rect));
    }

    /// Take a window out of the desktop in front's layout.
    pub fn close_surface(&mut self, id: &str) {
        self.edit(|l| l.surfaces.retain(|p| p.id != id));
    }

    pub fn toggle_pin(&mut self, id: &str) {
        self.update(id, |p| p.pinned = !p.pinned);
    }

    /// A new normal window opens where the person is looking: its place on screen as canvas
    /// coordinates at the pan of the desktop in front. A floating one is already in the screen's.
    pub fn in_view(&self, p: Placement) -> Placement {
        if p.floating == Some(true) {
            return p;
        }
        let pan = self.pan_of(&self.here());
        Placement {
            x: p.x - pan.x,
            y: p.y - pan.y,
            ..p
        }
    }

    /// Open window `id` on the desktop in front, at `placement` or its default place in sight, and
    /// focus it. Placed now, it leaves the drawer by the drawer's rule.
    pub fn open_surface(&mut self, id: &str, placement: Option<Placement>) {
        if !self.layout().surfaces.iter().any(|p| p.id == id) {
            let p = placement.unwrap_or_else(|| self.in_view(default_placement(id)));
            self.edit(|l| {
                let placed = cascade(p, &l.surfaces);
                l.surfaces.push(placed);
            });
        }
        self.focused = Some(id.to_string());
        self.pane = None;
    }

    /// Where Eris sits on the desktop in front; `None`: her default place.
    pub fn move_eris(&mut self, at: Option<Offset>) {
        self.edit(|l| l.eris = at);
    }

    pub fn desktop_is_empty(&self, r: impl Into<DesktopRef>) -> bool {
        self.layout_of(r).surfaces.is_empty()
    }

    /// Bring a desktop to the front; the window in use on the one left is kept for coming back.
    pub fn set_desktop(&mut self, r: impl Into<DesktopRef>) {
        let from = self.here();
        let to = self.id_of(r);
        self.focus_by.remove(&from);
        if let Some(window) = self.focused.take() {
            let pane = self.pane.clone();
            self.focus_by.insert(from, InUse { window, pane });
        }
        self.desktop = to;
        self.pane = None;
    }

    /// Bring a desktop to the front with the window it had in use when the person left it.
    pub fn switch_to(&mut self, r: impl Into<DesktopRef>) {
        let Some(to) = id_at(self.desktops(), &r.into()) else {
            return;
        };
        let here = self.here();
        self.set_desktop(to.as_str());
        if to == here {
            return;
        }
        if let Some(back) = self.focus_by.get(&to).cloned()
            && self
                .windows_of(to.as_str())
                .iter()
                .any(|p| p.id == back.window)
        {
            self.focus_pane(&back.window, back.pane.as_deref());
        }
    }

    /// The next desktop (`by` 1) or the one before (-1), round the list.
    pub fn step_desktop(&mut self, by: i64) {
        let next = step_from(self.desktops(), &self.here(), by);
        self.switch_to(next.as_str());
    }

    /// The runtime handed over plugin `id`'s surface (`adopt` in `surface/host.ts`). One handed
    /// over again keeps its slot and its pan; a new one takes the first slot left free and the pan
    /// of the desktop in front, so its slot opens in sight.
    pub fn adopt(&mut self, id: &str, title: &str) {
        let known = self.adopted.iter().find(|a| a.id == id).cloned();
        let others: Vec<Adopted> = self
            .adopted
            .iter()
            .filter(|a| a.id != id)
            .cloned()
            .collect();
        let slot = known.as_ref().and_then(|a| a.slot).unwrap_or_else(|| {
            free_slot(others.iter().enumerate().map(|(i, a)| a.slot.unwrap_or(i)))
        });
        let at = known
            .and_then(|a| a.at)
            .or_else(|| self.pan.get(&self.here()).copied());
        self.adopted = others;
        self.adopted.push(Adopted {
            id: id.to_string(),
            title: title.to_string(),
            slot: Some(slot),
            at,
        });
    }

    /// The runtime let plugin `id`'s surface go (it unmounted): its slot is free again, and a
    /// window that shows only it is not drawn until it comes back.
    pub fn release(&mut self, id: &str) {
        self.adopted.retain(|a| a.id != id);
    }
}
