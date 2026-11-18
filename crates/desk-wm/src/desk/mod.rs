//! One `Desk` state: the window manager's part of the shell's store (`DeskState` in
//! `packages/runtime/src/shell/state.ts`, read by `shell/actions.ts`). It holds the profile's saved
//! desktops, the session's moves over them, the desktop in front, each desktop's pan and window
//! in use, the plugin surfaces handed over, the drawer and the focus. Its JSON keeps the runtime's
//! names and shapes. Operations are plain methods over it, split by concern:
//!
//! - `edit`: session edits of a desktop's layout, opening windows, switching desktops.
//! - `windows`: focusing tabs, showing plugins, new windows, adding and closing tabs, fills.
//! - `focus`: the focus order and cycling.
//! - `drawer`: putting away, bringing back, a profile switch; the drawer holds only what is away.
//! - `desktops`, `moves`: the list's changes and windows moved across (ADR 0117).
//! - `arrange`: tile, cascade and their restore (ADR 0116).
//!
//! What the session and the profiles persist stays theirs (the core's records): they read and
//! write this state's parts, and `snapshot` (`snapshot.rs`) answers `desk.windows.list`.

mod arrange;
mod desktops;
mod drawer;
mod edit;
mod focus;
mod moves;
mod out;
mod session;
mod windows;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub use arrange::{ArrangeKind, Arranged, Arranger, Kept, Restored};
pub use desktops::{OnRemove, Removal};
pub use edit::default_placement;
pub use moves::Moved;

use crate::coordinates::ORIGIN;
use crate::cover::UseOrder;
use crate::desktops::{Desktop, DesktopId, DesktopRef, id_at};
use crate::drawer::DrawerItem;
use crate::layout::{DesktopLayout, Saved};
use crate::placed::{PLUGIN_VIEW, resolve_view};
use crate::tiling::slot_windows;
use crate::types::{Adopted, Offset, Placement};

/// The window, and the tab in it, a desktop had in use when the person left it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct InUse {
    pub window: String,
    #[serde(default, alias = "pane")]
    pub tab: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Desk {
    /// The profile in force, as the window manager reads it.
    #[serde(default)]
    pub saved: Saved,
    /// The desktop in front, by id; one the list does not have (or none) reads as the first.
    #[serde(default)]
    pub desktop: DesktopId,
    /// The desktops' layouts moved since the profile was saved, by id.
    #[serde(default)]
    pub session: BTreeMap<DesktopId, DesktopLayout>,
    /// The desktops as the person changed them since the profile was saved; `None`: the profile's.
    #[serde(default)]
    pub desktops: Option<Vec<Desktop>>,
    /// Each desktop's canvas pan, by id; navigating does not change the saved layout.
    #[serde(default)]
    pub pan: BTreeMap<DesktopId, Offset>,
    /// The window in use on each desktop the person left, by id.
    #[serde(default)]
    pub focus_by: BTreeMap<DesktopId, InUse>,
    /// The plugin surfaces the runtime handed over (ADR 0040), in mount order.
    #[serde(default)]
    pub adopted: Vec<Adopted>,
    /// What is put away: never a window a desktop places (#4).
    #[serde(default)]
    pub drawer: Vec<DrawerItem>,
    /// The window with the keyboard and the pointer; it draws on top.
    #[serde(default)]
    pub focused: Option<String>,
    /// The tab in use inside it: the one that window shows.
    #[serde(default, alias = "pane")]
    pub tab: Option<String>,
    /// The windows in the order they were last in use, which they stack in (`cover.rs`).
    #[serde(default, skip_serializing_if = "UseOrder::is_empty")]
    pub used: UseOrder,
}

impl Default for Desk {
    /// A fresh desk: the base profile's four empty desktops, the first in front.
    fn default() -> Self {
        Self::new(Saved::default())
    }
}

impl Desk {
    /// A desk with `saved` in force and nothing moved, its first desktop in front.
    pub fn new(saved: Saved) -> Self {
        let desktop = saved.list.first().map_or("1".into(), |d| d.id.clone());
        Self {
            saved,
            desktop,
            session: BTreeMap::new(),
            desktops: None,
            pan: BTreeMap::new(),
            focus_by: BTreeMap::new(),
            adopted: Vec::new(),
            drawer: Vec::new(),
            focused: None,
            tab: None,
            used: UseOrder::default(),
        }
    }

    /// Change anything, as the shell's store does: afterwards the drawer lets go of every window a
    /// desktop places (`keepAway`), whoever placed it.
    pub fn set(&mut self, change: impl FnOnce(&mut Desk)) {
        change(self);
        self.keep_away();
    }

    /// A desk built from its parts (restored, say), kept to the same rule.
    pub fn settled(mut self) -> Self {
        self.keep_away();
        self
    }

    /// The desktops in order (ADR 0117): as the person changed them, else as the profile saved them.
    pub fn desktops(&self) -> &[Desktop] {
        self.desktops.as_deref().unwrap_or(&self.saved.list)
    }

    /// A desktop's id, by id or position; the first desktop for one the list does not have.
    pub fn id_of(&self, r: impl Into<DesktopRef>) -> DesktopId {
        let list = self.desktops();
        id_at(list, &r.into())
            .or_else(|| list.first().map(|d| d.id.clone()))
            .unwrap_or_else(|| "1".into())
    }

    /// The desktop in front's id.
    pub fn here(&self) -> DesktopId {
        self.id_of(self.desktop.as_str())
    }

    /// A desktop's layout: as the session moved it, else as the profile saved it.
    pub fn layout_of(&self, r: impl Into<DesktopRef>) -> DesktopLayout {
        let id = self.id_of(r);
        self.session
            .get(&id)
            .unwrap_or_else(|| self.saved.layout(&id))
            .clone()
    }

    /// The layout of the desktop in front.
    pub fn layout(&self) -> DesktopLayout {
        self.layout_of(self.here())
    }

    /// A desktop's canvas pan; none is the origin.
    pub fn pan_of(&self, id: &str) -> Offset {
        self.pan.get(id).copied().unwrap_or(ORIGIN)
    }

    /// Put desktop `id`'s canvas at `pan`, within the canvas's extent (`pan::bounded`): the one
    /// way a pan is kept.
    pub fn set_pan(&mut self, id: DesktopId, pan: Offset) {
        self.pan.insert(id, crate::pan::bounded(pan));
    }

    /// Whether the session moved something away from what the profile saved: a layout, or the
    /// list of desktops.
    pub fn dirty(&self) -> bool {
        if self
            .desktops
            .as_ref()
            .is_some_and(|l| l != &self.saved.list)
        {
            return true;
        }
        self.session
            .iter()
            .any(|(id, layout)| layout != self.saved.layout(id))
    }

    /// Whether the runtime holds plugin `id`'s surface.
    pub fn holds(&self, id: &str) -> bool {
        self.adopted.iter().any(|a| a.id == id)
    }

    /// The view a tab of `p` shows: a tab named after its window whose plugin the runtime
    /// holds shows that plugin (`resolveView`).
    pub fn resolve(&self, p: &Placement, view: &str) -> String {
        resolve_view(p, view, |id| self.holds(id))
    }

    /// The plugins `p`'s tabs show, each once, first tab first: what closing it unmounts.
    pub fn plugins_of(&self, p: &Placement) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for tab in p.tabs() {
            if let Some(id) = self.resolve(p, &tab.view).strip_prefix(PLUGIN_VIEW)
                && !out.iter().any(|known| known == id)
            {
                out.push(id.to_string());
            }
        }
        out
    }

    /// The plugin `p` has on screen: the one the tab it shows shows, if that is a plugin's. Those
    /// in its other tabs are out of sight (ADR 0268).
    pub fn shown_plugins(&self, p: &Placement) -> Vec<String> {
        (self.resolve(p, &p.shown().view).strip_prefix(PLUGIN_VIEW))
            .map(String::from)
            .into_iter()
            .collect()
    }

    /// A placed window showing nothing but plugins the runtime does not hold now (one that
    /// closed itself, was turned off or has not mounted yet) is not drawn; it keeps its place and
    /// comes back there when its plugin mounts again.
    fn shows_something(&self, p: &Placement) -> bool {
        p.tabs()
            .iter()
            .any(|tab| (tab.view.strip_prefix(PLUGIN_VIEW)).is_none_or(|id| self.holds(id)))
    }

    /// `p` with the tabs it has now (ADR 0268): in a window of several tabs, one showing a plugin's
    /// window the runtime does not hold is not there. Such a window closed by its plugin, or was
    /// open in a session before this one: a plugin's later windows (ADR 0212) do not come back
    /// with a layout. A window none of whose tabs is there keeps them all, and is not drawn.
    pub(super) fn with_live_tabs(&self, mut p: Placement) -> Placement {
        let Some(tabs) = p.tabs.as_ref().filter(|tabs| tabs.len() > 1) else {
            return p;
        };
        let live: Vec<_> = (tabs.iter())
            .filter(|tab| {
                (self.resolve(&p, &tab.view).strip_prefix(PLUGIN_VIEW))
                    .is_none_or(|id| self.holds(id))
            })
            .cloned()
            .collect();
        if !live.is_empty() && live.len() < tabs.len() {
            p.tabs = Some(live);
        }
        p
    }

    /// The plugin windows in their slots on a desktop (`autoPlacements`): those no layout of it
    /// places, not in the drawer, not living on another desktop (ADR 0117), and not a tab of
    /// another window (ADR 0268).
    pub fn auto_placements(&self, r: impl Into<DesktopRef>) -> Vec<Placement> {
        let here = self.id_of(r);
        let placed: Vec<String> = self
            .layout_of(here.as_str())
            .surfaces
            .into_iter()
            .map(|p| p.plugin)
            .collect();
        let elsewhere: Vec<String> = self
            .desktops()
            .iter()
            .filter(|d| d.id != here)
            .flat_map(|d| self.layout_of(d.id.as_str()).surfaces)
            .map(|p| p.id)
            .collect();
        // A plugin's window that is a tab of another window, wherever that one is.
        let tabbed: Vec<String> = (self.desktops().iter())
            .flat_map(|d| self.layout_of(d.id.as_str()).surfaces)
            .chain(self.drawer.iter().filter_map(|d| d.placement.clone()))
            .flat_map(|p| p.tabs.unwrap_or_default())
            .filter_map(|tab| tab.view.strip_prefix(PLUGIN_VIEW).map(String::from))
            .collect();
        slot_windows(&self.adopted, |id| {
            placed.iter().any(|p| p == id)
                || tabbed.iter().any(|p| p == id)
                || self
                    .drawer
                    .iter()
                    .any(|d| d.placement.as_ref().is_some_and(|p| p.plugin == id))
                || elsewhere.iter().any(|p| p == id)
        })
    }

    /// Every window on a desktop's canvas in desk order: the plugin windows in their slots, then
    /// what its layout places and draws. What a profile, a move or an open placed lies over the
    /// slots (#158): a profile's windows are not opened under the plugin windows already there. A
    /// window out in an OS window of its own is not on the canvas (`out_windows`, #235).
    pub fn windows_of(&self, r: impl Into<DesktopRef>) -> Vec<Placement> {
        let id = self.id_of(r);
        let mut all = self.auto_placements(id.as_str());
        all.extend(
            self.layout_of(id.as_str())
                .surfaces
                .into_iter()
                .filter(|p| p.out.is_none() && self.shows_something(p))
                .map(|p| self.with_live_tabs(p)),
        );
        all
    }

    /// Every window on the desktop in front.
    pub fn windows(&self) -> Vec<Placement> {
        self.windows_of(self.here())
    }

    /// One window on the desktop in front.
    pub fn window(&self, id: &str) -> Option<Placement> {
        self.windows().into_iter().find(|p| p.id == id)
    }
}
