//! Windows and their tabs (`packages/runtime/src/shell/windows.ts`): focusing a tab, revealing a
//! plugin, ⌘N's new window with a launcher, adding a tab of the window's own kind (ADR 0268),
//! closing tabs and windows, showing another view in a tab, and the fills (`fill.rs`) as session
//! edits.
//!
//! The runtime's side stays the runtime's: the plugin surface in use (`focused_plugin`) is what
//! takes the keys, and closing a window answers the plugins to unmount for the session (ADR 0040);
//! the runtime's unmount then `release`s them.

use std::collections::BTreeSet;

use crate::fill::{fill_with, toggle_floating, toggle_maximize};
use crate::placed::PLUGIN_VIEW;
use crate::tabs::{self, LAUNCHER, kind_of};
use crate::types::{Fill, Placement, Rect, Tab};

use super::Desk;

/// A new window's size.
const NEW_W: f64 = 480.0;
const NEW_H: f64 = 320.0;
/// Where new windows start, and how far each of the next five steps down and right.
const NEW_X: f64 = 480.0;
const NEW_Y: f64 = 240.0;
const NEW_STEP: f64 = 32.0;

impl Desk {
    /// Put a window of the desktop in front in use, showing one of its tabs: the one named, else
    /// the one it shows. A window not on the desktop in front takes no focus.
    pub fn focus_tab(&mut self, window: &str, tab: Option<&str>) {
        // A window out of the canvas is in use while its OS window has the keys (#235).
        let out = || self.out_window(window).map(|(_, p)| p);
        let Some(p) = self.window(window).or_else(out) else {
            return;
        };
        let shown = p.shown().id;
        let target = (tab.filter(|id| tabs::find(&p.tabs(), id).is_some()))
            .map_or_else(|| shown.clone(), String::from);
        if target != shown {
            self.show_tab(&p, &target);
        }
        self.focused = Some(window.to_string());
        self.used.touch(window);
        self.tab = Some(target);
    }

    /// Window `p` shows its tab `tab` from now, wherever it is: on the desktop in front, or out
    /// of the canvas.
    fn show_tab(&mut self, p: &Placement, tab: &str) {
        let tab = Some(tab.to_string());
        if p.out.is_some() {
            self.change_out(&p.id, |q| q.tab = tab);
        } else {
            self.update(&p.id, |q| q.tab = tab);
        }
    }

    /// The window in use, for the window commands; none when it is not on the desktop in front.
    pub fn focused_window(&self) -> Option<String> {
        let id = self.focused.as_deref()?;
        self.window(id).map(|p| p.id)
    }

    /// The tab in use: the one the window in use shows.
    fn focused_leaf(&self) -> Option<(Placement, String, String)> {
        let p = self.window(self.focused.as_deref()?)?;
        let Tab { id, view } = p.shown();
        Some((p, id, view))
    }

    /// The plugin surface in use, which takes the keys and the buffers: the one the tab in use
    /// shows. A view of the shell's own in use leaves none.
    pub fn focused_plugin(&self) -> Option<String> {
        let (p, _, view) = self.focused_leaf()?;
        self.resolve(&p, &view)
            .strip_prefix(PLUGIN_VIEW)
            .map(String::from)
    }

    /// The tab of `p` that shows plugin `id`.
    fn pane_showing(&self, p: &Placement, id: &str) -> Option<String> {
        let want = format!("{PLUGIN_VIEW}{id}");
        (p.tabs().into_iter())
            .find(|tab| self.resolve(p, &tab.view) == want)
            .map(|tab| tab.id)
    }

    /// Reveal plugin `id`: its tab on the desktop in front, else its window out of the canvas
    /// (#239), else on the desktop that shows it (the desk goes there, ADR 0117), else from the
    /// drawer, else in a new window.
    pub fn show_plugin(&mut self, id: &str) {
        let shown = self
            .windows()
            .into_iter()
            .find_map(|p| self.pane_showing(&p, id).map(|pane| (p.id, pane)));
        // Out of the canvas, in an OS window of its own: that window is in use, where it is.
        let shown = shown.or_else(|| {
            (self.out_windows().into_iter())
                .find_map(|(_, p)| self.pane_showing(&p, id).map(|pane| (p.id, pane)))
        });
        if let Some((window, pane)) = shown {
            self.focus_tab(&window, Some(&pane));
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
            self.focus_tab(&window, Some(&pane));
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
                self.focus_tab(&window, Some(&pane));
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

    /// A new window with one launcher tab (⌘N), cascading from the middle of what is in sight,
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
        p.tabs = Some(vec![Tab::new("p1", LAUNCHER)]);
        let placed = self.in_view(p);
        self.open_surface(&id, Some(placed));
        self.focus_tab(&id, Some("p1"));
        id
    }

    /// The plugin every tab of `p` shows a window of (ADR 0212): the kind of tab it takes. None
    /// for a window showing a view of the shell's own, or windows of different plugins (a layout
    /// saved while a window split inside): it takes no tab.
    pub fn tab_kind(&self, p: &Placement) -> Option<String> {
        let tabs = p.tabs();
        let kinds: Vec<Option<String>> = (tabs.iter())
            .map(|tab| kind_of(&self.resolve(p, &tab.view)).map(String::from))
            .collect();
        let first = kinds.first()?.clone()?;
        kinds
            .iter()
            .all(|k| k.as_deref() == Some(first.as_str()))
            .then_some(first)
    }

    /// Add a tab showing `view` to window `window` of the desktop in front, right after the tab it
    /// shows, and show it. A window takes only tabs of its own kind (ADR 0268): `view` is another
    /// window of the plugin its tabs show, one no tab of it shows yet. Answers the new tab's id;
    /// none when the window does not take it.
    pub fn add_tab(&mut self, window: &str, view: &str) -> Option<String> {
        let p = self.window(window)?;
        let kind = self.tab_kind(&p)?;
        let all = p.tabs();
        let taken = all.iter().any(|tab| self.resolve(&p, &tab.view) == view);
        if kind_of(view) != Some(kind.as_str()) || taken {
            return None;
        }
        let (next, added) = tabs::add(&all, &p.shown().id, view);
        self.update(window, |q| {
            q.tabs = Some(next);
            q.tab = Some(added.clone());
        });
        self.focus_tab(window, Some(&added));
        Some(added)
    }

    /// The window in use shows the tab `step` places on (1 next, -1 previous), wrapping around.
    pub fn step_tab(&mut self, step: i64) {
        let Some((p, shown, _)) = self.focused_leaf() else {
            return;
        };
        let all = p.tabs();
        let n = all.len() as i64;
        let at = all.iter().position(|t| t.id == shown).unwrap_or(0) as i64;
        let next = usize::try_from((at + step).rem_euclid(n)).unwrap_or(0);
        if let Some(tab) = all.get(next) {
            self.focus_tab(&p.id, Some(&tab.id));
        }
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
            self.tab = None;
        }
        plugins
    }

    /// Close a tab of a window (the window in use unless named): the one named, else the one it
    /// shows. The window shows the tab that followed it and stays in use; its last tab closes the
    /// window. Answers the plugins to unmount: the one the tab showed, or the window's.
    pub fn close_tab(&mut self, window: Option<&str>, tab: Option<&str>) -> Vec<String> {
        let id = window.map(String::from).or_else(|| self.focused_window());
        let Some(p) = id.and_then(|id| self.window(&id)) else {
            return Vec::new();
        };
        let all = p.tabs();
        let target = tab.map_or_else(|| p.shown().id, String::from);
        let Some(closed) = tabs::find(&all, &target) else {
            return Vec::new();
        };
        let plugin = (self.resolve(&p, &closed.view).strip_prefix(PLUGIN_VIEW)).map(String::from);
        let Some((next, beside)) = tabs::close(&all, &target) else {
            return self.close_window(&p.id);
        };
        // The window goes on showing the tab it showed, unless that is the one closed.
        let show = if p.shown().id == target {
            beside
        } else {
            p.shown().id
        };
        self.update(&p.id, |q| {
            q.tabs = Some(next);
            q.tab = Some(show.clone());
        });
        self.focus_tab(&p.id, Some(&show));
        plugin.into_iter().collect()
    }

    /// Tab `tab` of `window` shows `view`, and takes the focus.
    pub fn show_in_tab(&mut self, window: &str, tab: &str, view: &str) {
        if self.window(window).is_none() {
            return;
        }
        self.update(window, |q| {
            q.tabs = Some(tabs::set_view(&q.tabs(), tab, view))
        });
        self.focus_tab(window, Some(tab));
    }

    /// Bring a view up: into the launcher tab in use if there is one, else focus a tab that
    /// already shows it, else open it as a window of its own (a new one when a window named after
    /// it now shows something else).
    pub fn open_view(&mut self, view: &str) {
        if let Some((p, tab, shown)) = self.focused_leaf()
            && shown == LAUNCHER
        {
            self.show_in_tab(&p.id, &tab, view);
            return;
        }
        let windows = self.windows();
        let found = windows.iter().find_map(|p| {
            let tab = p.tabs().into_iter().find(|tab| tab.view == view)?;
            Some((p.id.clone(), tab.id))
        });
        if let Some((window, pane)) = found {
            self.focus_tab(&window, Some(&pane));
            return;
        }
        if windows.iter().any(|p| p.id == view) {
            let fresh = self.new_window();
            self.show_in_tab(&fresh, "p1", view);
            return;
        }
        self.open_surface(view, None);
        self.focus_tab(view, None);
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
