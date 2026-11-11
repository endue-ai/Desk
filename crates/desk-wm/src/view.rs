//! What the runtime reads of the window manager (#83): published with the `Desk` on every change,
//! so the page never works out a window itself. The desktops in order and the one in front, every
//! desktop's windows as drawn (its layout's, then the plugin windows in their slots) and layout,
//! whether the profile in force changed, the plugin surface in use, what `desk.shell.layouts` keeps
//! for the session, whether an arrangement can be put back, and for the desktop in front each
//! window where it is on screen and at what stacking level, with the plugins out of sight.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::coordinates::screen_rect;
use crate::cover::covered_plugins;
use crate::desk::{Arranger, Desk};
use crate::desktops::{Desktop, DesktopId};
use crate::layout::DesktopLayout;
use crate::migrate::{StoredMoved, write_moved};
use crate::types::{Placement, Rect, Size};

/// A window of the desktop in front, where it is drawn.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Shown {
    pub id: String,
    /// On screen, in CSS pixels of the app.
    pub rect: Rect,
    /// Its stacking level (`cover::z_of`): the one in use on top, then the order of use.
    pub z: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub desktops: Vec<Desktop>,
    pub here: DesktopId,
    /// Every desktop's windows in desk order, by id.
    pub windows: BTreeMap<DesktopId, Vec<Placement>>,
    /// Every desktop's layout as drawn: the session's, else the profile's.
    pub layouts: BTreeMap<DesktopId, DesktopLayout>,
    /// The session moved something from what the profile in force saved.
    pub dirty: bool,
    /// The plugin surface the pane in use shows: it takes the keys.
    pub focused_plugin: Option<String>,
    /// What `desk.shell.layouts`' session layer keeps; `None` when nothing moved.
    pub moved: Option<StoredMoved>,
    /// The desktop in front has an arrangement to put back (ADR 0116).
    pub restorable: bool,
    /// The app's size the windows are placed on.
    pub screen: Size,
    /// The desktop in front's windows in desk order, where each is drawn.
    pub front: Vec<Shown>,
    /// Every desktop's windows on screen as they are when it is in front (at its own pan), by
    /// desktop and window.
    pub rects: BTreeMap<DesktopId, BTreeMap<String, Rect>>,
    /// The plugins only windows out of sight show (ADR 0070).
    pub covered: Vec<String>,
    /// Every window id on the desk (#101).
    pub ids: Vec<String>,
}

impl View {
    /// What `desk` publishes on a `screen`-sized app, its arrangements in `arranger`.
    pub fn of(desk: &Desk, arranger: &Arranger, screen: Size) -> View {
        let desktops = desk.desktops().to_vec();
        let here = desk.here();
        let windows: BTreeMap<DesktopId, Vec<Placement>> = (desktops.iter())
            .map(|d| (d.id.clone(), desk.windows_of(d.id.as_str())))
            .collect();
        let rects = (windows.iter())
            .map(|(id, list)| {
                let pan = desk.pan_of(id);
                let on = |p: &Placement| (p.id.clone(), screen_rect(p, pan, screen.w, screen.h));
                (id.clone(), list.iter().map(on).collect())
            })
            .collect();
        let layouts = (desktops.iter())
            .map(|d| (d.id.clone(), desk.layout_of(d.id.as_str())))
            .collect();
        let moved = (desk.desktops.is_some() || !desk.session.is_empty())
            .then(|| write_moved(desk.desktops(), &desk.session));
        let pan = desk.pan_of(&here);
        let shown = desk.windows();
        let levels = desk.used.levels(&shown, desk.focused.as_deref());
        let front = (shown.iter().zip(&levels))
            .map(|(p, z)| Shown {
                id: p.id.clone(),
                rect: screen_rect(p, pan, screen.w, screen.h),
                z: *z,
            })
            .collect();
        let covered = covered_plugins(
            &shown,
            &levels,
            |p| desk.plugins_of(p),
            pan,
            screen.w,
            screen.h,
        );
        View {
            desktops,
            here,
            windows,
            layouts,
            dirty: desk.dirty(),
            focused_plugin: desk.focused_plugin(),
            moved,
            restorable: arranger.can_restore(desk, None),
            screen,
            front,
            rects,
            covered: covered.into_iter().collect(),
            ids: desk.window_ids().into_iter().collect(),
        }
    }
}
