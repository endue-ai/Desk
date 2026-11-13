//! Windows out of the canvas (#235, ADR 0205): any window can pop out into an OS window of its own
//! and dock back. It keeps its id, its desktop and its place on that desktop's canvas, and holds
//! its OS frame (`Placement::out`) while it is out. An out window is on no canvas
//! (`windows_of`): the compositor draws nothing for it, and tile, cascade, the spread and the
//! canvas map leave it out; it stays in the order of use, the window list, the live budget, and it
//! closes as any window does. Docking puts it back where it was on its desktop's canvas, brings
//! that desktop to the front and gives it the focus.

use crate::desktops::DesktopId;
use crate::types::{Placement, Rect};

use super::Desk;

impl Desk {
    /// Every window out of the canvas, with the desktop it docks back to, in desk order.
    pub fn out_windows(&self) -> Vec<(DesktopId, Placement)> {
        (self.desktops().iter())
            .flat_map(|d| {
                (self.layout_of(d.id.as_str()).surfaces.into_iter())
                    .filter(|p| p.out.is_some() && self.shows_something(p))
                    .map(|p| (d.id.clone(), p))
            })
            .collect()
    }

    /// Window `id`, out of the canvas, with its desktop.
    pub fn out_window(&self, id: &str) -> Option<(DesktopId, Placement)> {
        self.out_windows().into_iter().find(|(_, p)| p.id == id)
    }

    /// Window `id` of the desktop in front leaves the canvas for an OS window at `frame`; a plugin
    /// window in its slot is placed on that desktop first. Whether it did.
    pub fn pop_out(&mut self, id: &str, frame: Rect) -> bool {
        if self.window(id).is_none() {
            return false;
        }
        self.update(id, |p| p.out = Some(frame));
        true
    }

    /// Out window `id`'s OS window is at `frame` now. Whether it is out.
    pub fn set_out_frame(&mut self, id: &str, frame: Rect) -> bool {
        self.change_out(id, |p| p.out = Some(frame))
    }

    /// Out window `id` docks back where it was on its desktop's canvas; that desktop comes to the
    /// front with it in use. Whether it was out.
    pub fn dock(&mut self, id: &str) -> bool {
        let Some((desktop, _)) = self.out_window(id) else {
            return false;
        };
        self.change_out(id, |p| p.out = None);
        if desktop != self.here() {
            self.set_desktop(desktop.as_str());
        }
        self.focus_pane(id, None);
        true
    }

    /// Close out window `id`: the plugins it showed, to unmount.
    pub(super) fn close_out(&mut self, id: &str) -> Vec<String> {
        let Some((desktop, p)) = self.out_window(id) else {
            return Vec::new();
        };
        let plugins = self.plugins_of(&p);
        self.edit_at(desktop.as_str(), |l| l.surfaces.retain(|p| p.id != id));
        if self.focused.as_deref() == Some(id) {
            self.focused = None;
            self.pane = None;
        }
        plugins
    }

    fn change_out(&mut self, id: &str, change: impl FnOnce(&mut Placement)) -> bool {
        let Some((desktop, _)) = self.out_window(id) else {
            return false;
        };
        self.edit_at(desktop.as_str(), |l| {
            if let Some(p) = l.surfaces.iter_mut().find(|p| p.id == id) {
                change(p);
            }
        });
        true
    }
}
