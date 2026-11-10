//! The desk as the window manager sees it, for `desk.windows.list` (#53; `deskSnapshot` in
//! `packages/runtime/src/shell/desk-view.ts`, which read the DOM's store): every window, those of
//! the desktop in front first, front to back, then those put away in the drawer, then those of
//! the other desktops in their order. Each says where it is on screen (a window on another desktop:
//! where it is when that desktop comes to the front; one in the drawer: where it comes back), its
//! stacking level, its desktop, its state and its panes. A plugin window in its slot is on every
//! desktop until it is moved (ADR 0117): it is named once, where it is seen.
//!
//! Titles of the shell's own views, the frames' responsiveness and the contract's limits are the
//! command's to add (#82); a plugin pane's title is the one the runtime handed over.

use serde::{Deserialize, Serialize};

use crate::coordinates::{is_floating, screen_rect};
use crate::cover::z_of;
use crate::desk::Desk;
use crate::desktops::DesktopId;
use crate::placed::PLUGIN_VIEW;
use crate::types::{Fill, Offset, Placement, Size};

fn no(b: &bool) -> bool {
    !*b
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Snapshot {
    /// The app's size in pixels.
    pub screen: Size,
    /// The desktops in order; `current` marks the one in front.
    pub desktops: Vec<DesktopSnapshot>,
    pub windows: Vec<WindowSnapshot>,
    /// The window in use, and its pane.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focused: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pane: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopSnapshot {
    pub id: DesktopId,
    pub name: String,
    #[serde(default, skip_serializing_if = "no")]
    pub current: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WindowSnapshot {
    pub id: String,
    pub plugin: String,
    /// The desktop it is on; absent for a window in the drawer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub desktop: Option<DesktopId>,
    /// Where it is drawn, in app pixels from the top left.
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    /// Its stacking level on its desktop, higher in front (`cover::z_of`); none in the drawer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub z: Option<usize>,
    #[serde(default, skip_serializing_if = "no")]
    pub floating: bool,
    #[serde(default, skip_serializing_if = "no")]
    pub pinned: bool,
    /// The part of the app it fills (ADR 0128, ADR 0132).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Fill>,
    /// It is the window in use, on the desktop in front.
    #[serde(default, skip_serializing_if = "no")]
    pub focused: bool,
    /// It waits in the drawer.
    #[serde(default, skip_serializing_if = "no")]
    pub hidden: bool,
    pub panes: Vec<PaneSnapshot>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaneSnapshot {
    pub id: String,
    /// The view it shows: `plugin:<id>`, `launcher`, an item's view.
    pub view: String,
    /// The plugin that draws it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugin: Option<String>,
    /// That plugin's title, as the runtime handed it over.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// It is the pane in use.
    #[serde(default, skip_serializing_if = "no")]
    pub focused: bool,
}

/// Where a window is listed: on a desktop at its stacking level, or in the drawer.
#[derive(Clone, Copy)]
struct Seat<'a> {
    desktop: Option<&'a str>,
    z: Option<usize>,
    pan: Offset,
}

impl Desk {
    /// A desktop's windows front to back, with their stacking levels; the focus counts only on the
    /// desktop in front.
    fn stack(&self, desktop: &str) -> Vec<(Placement, usize)> {
        let focused = (desktop == self.here())
            .then_some(self.focused.as_deref())
            .flatten();
        let mut all: Vec<(Placement, usize)> = self
            .windows_of(desktop)
            .into_iter()
            .enumerate()
            .map(|(i, p)| {
                let z = z_of(&p, i, focused);
                (p, z)
            })
            .collect();
        all.sort_by_key(|a| std::cmp::Reverse(a.1));
        all
    }

    fn window_snapshot(&self, p: &Placement, seat: Seat, vw: f64, vh: f64) -> WindowSnapshot {
        let rect = screen_rect(p, seat.pan, vw, vh);
        let focused = seat.desktop == Some(self.here().as_str())
            && self.focused.as_deref() == Some(p.id.as_str());
        let tree = p.panes();
        let leaves = tree.leaves();
        let in_use = focused
            .then(|| {
                leaves
                    .iter()
                    .find(|(id, _)| Some(*id) == self.pane.as_deref())
                    .or(leaves.first())
                    .map(|(id, _)| *id)
            })
            .flatten();
        let panes = leaves
            .iter()
            .map(|(id, view)| {
                let view = self.resolve(p, view);
                let plugin = view.strip_prefix(PLUGIN_VIEW).map(String::from);
                let title = plugin.as_ref().and_then(|id| {
                    self.adopted
                        .iter()
                        .find(|a| &a.id == id)
                        .map(|a| a.title.clone())
                });
                PaneSnapshot {
                    id: id.to_string(),
                    view,
                    plugin,
                    title,
                    focused: Some(*id) == in_use,
                }
            })
            .collect();
        WindowSnapshot {
            id: p.id.clone(),
            plugin: p.plugin.clone(),
            desktop: seat.desktop.map(String::from),
            x: rect.x,
            y: rect.y,
            w: rect.w,
            h: rect.h,
            z: seat.z,
            floating: is_floating(p),
            pinned: p.pinned,
            fill: p.fill,
            focused,
            hidden: seat.desktop.is_none(),
            panes,
        }
    }

    /// The desk now on a `vw`×`vh` app: what `desk.windows.list` answers.
    pub fn snapshot(&self, vw: f64, vh: f64) -> Snapshot {
        let here = self.here();
        fn seat<'a>(desk: &Desk, desktop: &'a str, z: usize) -> Seat<'a> {
            Seat {
                desktop: Some(desktop),
                z: Some(z),
                pan: desk.pan_of(desktop),
            }
        }
        let front = self.stack(&here);
        let mut windows: Vec<WindowSnapshot> = front
            .iter()
            .map(|(p, z)| self.window_snapshot(p, seat(self, &here, *z), vw, vh))
            .collect();
        let away = Seat {
            desktop: None,
            z: None,
            pan: self.pan_of(&here),
        };
        windows.extend(self.drawer.iter().filter_map(|d| {
            let p = d.placement.as_ref()?;
            Some(self.window_snapshot(p, away, vw, vh))
        }));
        let listed: Vec<&str> = front.iter().map(|(p, _)| p.id.as_str()).collect();
        for d in self.desktops().iter().filter(|d| d.id != here) {
            let placed = self.layout_of(d.id.as_str()).surfaces;
            for (p, z) in self.stack(&d.id) {
                if placed.iter().any(|q| q.id == p.id) || !listed.contains(&p.id.as_str()) {
                    windows.push(self.window_snapshot(&p, seat(self, &d.id, z), vw, vh));
                }
            }
        }
        Snapshot {
            screen: Size { w: vw, h: vh },
            desktops: self
                .desktops()
                .iter()
                .map(|d| DesktopSnapshot {
                    id: d.id.clone(),
                    name: if d.name.is_empty() {
                        d.id.clone()
                    } else {
                        d.name.clone()
                    },
                    current: d.id == here,
                })
                .collect(),
            windows,
            focused: self.focused.clone(),
            pane: self.pane.clone(),
        }
    }
}
