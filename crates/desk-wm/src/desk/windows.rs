//! Windows and their panes (`packages/runtime/src/shell/windows.ts`): focusing a pane, revealing a
//! plugin, ⌘N's new window with a launcher, splitting the pane in use right or down, closing panes
//! and windows, showing another view in a pane, and the fills (`fill.rs`) as session edits.
//!
//! The runtime's side stays the runtime's: the plugin surface in use (`focused_plugin`) is what
//! takes the keys, and closing a window answers the plugins to unmount for the session (ADR 0040);
//! the runtime's unmount then `release`s them.

use std::collections::BTreeSet;

use crate::fill::{fill_with, toggle_floating, toggle_maximize};
use crate::pane_min::{body_size, fit_panes, window_min};
use crate::panes::{self, LAUNCHER};
use crate::placed::PLUGIN_VIEW;
use crate::types::{Fill, PaneNode, Placement, Rect, SplitDir};

use super::Desk;

/// A new window's size.
const NEW_W: f64 = 480.0;
const NEW_H: f64 = 320.0;
/// Where new windows start, and how far each of the next five steps down and right.
const NEW_X: f64 = 480.0;
const NEW_Y: f64 = 240.0;
const NEW_STEP: f64 = 32.0;

impl Desk {
    /// Focus a window of the desktop in front and one of its panes: the one named, else its first.
    /// A window not on the desktop in front takes no focus.
    pub fn focus_pane(&mut self, window: &str, pane: Option<&str>) {
        let Some(p) = self.window(window) else {
            return;
        };
        let tree = p.panes();
        let leaves = tree.leaves();
        let target = leaves
            .iter()
            .find(|(id, _)| Some(*id) == pane)
            .or(leaves.first())
            .map(|(id, _)| id.to_string());
        self.focused = Some(window.to_string());
        self.used.touch(window);
        self.pane = target;
    }

    /// The window in use, for the window commands; none when it is not on the desktop in front.
    pub fn focused_window(&self) -> Option<String> {
        let id = self.focused.as_deref()?;
        self.window(id).map(|p| p.id)
    }

    /// The pane in use: the one focused in the window in use, else that window's first.
    fn focused_leaf(&self) -> Option<(Placement, String, String)> {
        let p = self.window(self.focused.as_deref()?)?;
        let tree = p.panes();
        let leaves = tree.leaves();
        let (id, view) = self
            .pane
            .as_deref()
            .and_then(|want| leaves.iter().find(|(id, _)| *id == want))
            .or(leaves.first())?;
        let (id, view) = (id.to_string(), view.to_string());
        Some((p, id, view))
    }

    /// The plugin surface in use, which takes the keys and the buffers: the one the pane in use
    /// shows. A pane of the shell's own in use leaves none.
    pub fn focused_plugin(&self) -> Option<String> {
        let (p, _, view) = self.focused_leaf()?;
        self.resolve(&p, &view)
            .strip_prefix(PLUGIN_VIEW)
            .map(String::from)
    }

    /// The pane of `p` that shows plugin `id`.
    fn pane_showing(&self, p: &Placement, id: &str) -> Option<String> {
        let want = format!("{PLUGIN_VIEW}{id}");
        p.panes()
            .leaves()
            .into_iter()
            .find(|(_, view)| self.resolve(p, view) == want)
            .map(|(pane, _)| pane.to_string())
    }

    /// Reveal plugin `id`: its pane on the desktop in front, else on the desktop that shows it
    /// (the desk goes there, ADR 0117), else from the drawer, else in a new window.
    pub fn show_plugin(&mut self, id: &str) {
        let shown = self
            .windows()
            .into_iter()
            .find_map(|p| self.pane_showing(&p, id).map(|pane| (p.id, pane)));
        if let Some((window, pane)) = shown {
            self.focus_pane(&window, Some(&pane));
            return;
        }
        let there = self.desktops().iter().find_map(|d| {
            self.windows_of(d.id.as_str()).into_iter().find_map(|p| {
                self.pane_showing(&p, id)
                    .map(|pane| (d.id.clone(), p.id, pane))
            })
        });
        if let Some((desktop, window, pane)) = there {
            self.set_desktop(desktop.as_str());
            self.focus_pane(&window, Some(&pane));
            return;
        }
        let away = self.drawer.iter().find_map(|d| {
            let p = d.placement.as_ref()?;
            self.pane_showing(p, id)
                .map(|pane| (d.id.clone(), p.id.clone(), pane))
        });
        match away {
            Some((item, window, pane)) => {
                self.bring_back(&item);
                self.focus_pane(&window, Some(&pane));
            }
            None => self.open_view(&format!("{PLUGIN_VIEW}{id}")),
        }
    }

    /// Every window id on the desk (`windowIds`, #101): on each desktop, drawn or placed while its
    /// plugin is away (it comes back there), the plugin windows in their slots, and the drawer's.
    /// The drawer and `desk.windows.list` know a window by its id alone.
    pub fn window_ids(&self) -> BTreeSet<String> {
        let mut ids = BTreeSet::new();
        for d in self.desktops() {
            ids.extend(
                self.layout_of(d.id.as_str())
                    .surfaces
                    .into_iter()
                    .map(|p| p.id),
            );
            ids.extend(self.windows_of(d.id.as_str()).into_iter().map(|p| p.id));
        }
        ids.extend(
            self.drawer
                .iter()
                .filter_map(|d| d.placement.as_ref().map(|p| p.id.clone())),
        );
        ids
    }

    /// A new window with one launcher pane (⌘N), cascading from the middle of what is in sight,
    /// focused. Answers its id: `window-<n>`, the first number no window on any desktop and no
    /// drawer item has (#101).
    pub fn new_window(&mut self) -> String {
        let taken = self.window_ids();
        let id = (1..)
            .map(|n: u64| format!("window-{n}"))
            .find(|id| !taken.contains(id))
            .unwrap_or_default();
        let k = (self.layout().surfaces.len() % 6) as f64;
        let rect = Rect::new(NEW_X + NEW_STEP * k, NEW_Y + NEW_STEP * k, NEW_W, NEW_H);
        let mut p = Placement::new(id.clone(), "endue.window", rect);
        p.panes = Some(PaneNode::view("p1", LAUNCHER));
        let placed = self.in_view(p);
        self.open_surface(&id, Some(placed));
        self.focus_pane(&id, Some("p1"));
        id
    }

    /// Split the pane in use (`pane`, else the window's first) right (`Row`) or down (`Column`);
    /// the new pane opens the launcher and takes the focus.
    pub fn split(&mut self, dir: SplitDir) {
        let Some(p) = self.focused_window().and_then(|id| self.window(&id)) else {
            return;
        };
        let tree = p.panes();
        let target = self.pane.clone().unwrap_or_else(|| first_pane(&tree));
        let (next, added) = panes::split(&tree, &target, dir, LAUNCHER);
        // A window too small for its panes' headers grows to its new minimum (#159).
        let least = window_min(&next);
        self.update(&p.id, |q| {
            q.w = q.w.max(least.w);
            q.h = q.h.max(least.h);
            q.panes = Some(fit_panes(&next, body_size(q.w, q.h)));
        });
        self.focus_pane(&p.id, Some(&added));
    }

    /// Close a window of the desktop in front: it leaves the layout, and the plugins it shows are
    /// to unmount for the session (ADR 0040), so none comes back as a window of its own. Answers
    /// them; the runtime unmounts them.
    pub fn close_window(&mut self, id: &str) -> Vec<String> {
        let Some(p) = self.window(id) else {
            // One out of the canvas closes from whichever desktop it docks back to (#235).
            return self.close_out(id);
        };
        let plugins = self.plugins_of(&p);
        self.close_surface(id);
        if self.focused.as_deref() == Some(id) {
            self.focused = None;
            self.pane = None;
        }
        plugins
    }

    /// Close a pane of a window (the window in use unless named): the one named, else `pane`,
    /// else its first. The last pane closes its window (answering the plugins to unmount), and the
    /// focus goes to the first pane left.
    pub fn close_pane(&mut self, window: Option<&str>, pane: Option<&str>) -> Vec<String> {
        let id = window.map(String::from).or_else(|| self.focused_window());
        let Some(p) = id.and_then(|id| self.window(&id)) else {
            return Vec::new();
        };
        let tree = p.panes();
        let target = pane
            .map(String::from)
            .or_else(|| self.pane.clone())
            .unwrap_or_else(|| first_pane(&tree));
        let Some(next) = panes::close(&tree, &target) else {
            return self.close_window(&p.id);
        };
        let first = first_pane(&next);
        self.update(&p.id, |q| q.panes = Some(next));
        self.focus_pane(&p.id, Some(&first));
        Vec::new()
    }

    /// Pane `pane` of `window` shows `view`, and takes the focus.
    pub fn show_in_pane(&mut self, window: &str, pane: &str, view: &str) {
        if self.window(window).is_none() {
            return;
        }
        self.update(window, |q| {
            q.panes = Some(panes::set_view(&q.panes(), pane, view))
        });
        self.focus_pane(window, Some(pane));
    }

    /// A divider of `window` dropped at `ratio`, kept between 15 % and 85 %, and where the window
    /// has room, short of the panes on either side getting less than their minimum.
    pub fn resize_split(&mut self, window: &str, split: &str, ratio: f64) {
        self.update(window, |q| {
            let set = panes::set_ratio(&q.panes(), split, ratio);
            q.panes = Some(fit_panes(&set, body_size(q.w, q.h)));
        });
    }

    /// Bring a view up: into the launcher pane in use if there is one, else focus a pane that
    /// already shows it, else open it as a window of its own (a new one when a window named after
    /// it now shows something else).
    pub fn open_view(&mut self, view: &str) {
        if let Some((p, pane, shown)) = self.focused_leaf()
            && self.pane.as_deref() == Some(pane.as_str())
            && shown == LAUNCHER
        {
            self.show_in_pane(&p.id, &pane, view);
            return;
        }
        let windows = self.windows();
        let found = windows.iter().find_map(|p| {
            let tree = p.panes();
            let leaf = tree.leaves().into_iter().find(|(_, v)| *v == view)?;
            Some((p.id.clone(), leaf.0.to_string()))
        });
        if let Some((window, pane)) = found {
            self.focus_pane(&window, Some(&pane));
            return;
        }
        if windows.iter().any(|p| p.id == view) {
            let fresh = self.new_window();
            self.show_in_pane(&fresh, "p1", view);
            return;
        }
        self.open_surface(view, None);
        self.focus_pane(view, None);
    }

    /// Snap a window to a half or a quarter of the app, or fill it (ADR 0128, ADR 0132). It comes
    /// in front as if used, right behind the window in use when it is not that one.
    pub fn snap_to(&mut self, id: &str, fill: Fill) {
        self.update(id, |p| *p = fill_with(p, fill));
        self.used.touch(id);
    }

    /// Fill the whole app, or come back from a fill; in front as `snap_to` brings it.
    pub fn toggle_maximize(&mut self, id: &str) {
        self.update(id, |p| *p = toggle_maximize(p));
        self.used.touch(id);
    }

    /// Switch a window between normal and floating, keeping it where it is on a `vw`×`vh` app.
    pub fn toggle_floating(&mut self, id: &str, vw: f64, vh: f64) {
        let pan = self.pan_of(&self.here());
        self.update(id, |p| *p = toggle_floating(p, pan, vw, vh));
    }
}

/// A tree's first pane, `p1` for none.
fn first_pane(tree: &PaneNode) -> String {
    tree.leaves()
        .first()
        .map_or_else(|| "p1".into(), |(id, _)| id.to_string())
}
