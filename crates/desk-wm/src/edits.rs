//! What the runtime asks of the window manager (#83): every change it makes to the windows, the
//! panes, the desktops, the drawer, the pan, the profile in force and the session as one `Edit`,
//! which the window manager applies to its `Desk` and publishes whole (`interact::Published`). The
//! runtime keeps no window manager state of its own: it reads what was published and sends these.
//!
//! Each edit is one of `Desk`'s operations, or the `Arranger`'s, or the desktops' undo (`Undo`).
//! Some answer something (`apply`'s value): the id of a new window or desktop, the plugins a close
//! leaves to unmount, whether a move or an undo did anything, what an arrangement replaced. Times
//! are the runtime's wall clock in whole milliseconds; titles are its copy.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::desk::{ArrangeKind, Arranged, Arranger, Desk, OnRemove};
use crate::desktops::DesktopRef;
use crate::drawer::DrawerItem;
use crate::interact::{Change, Geometry};
use crate::layout::Saved;
use crate::tiling::GAP;
use crate::types::{Offset, Placement, Size, SplitDir};
use crate::undo::Undo;

/// What becomes of a removed desktop's windows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Windows {
    Move,
    Close,
}

/// One change the runtime asks for.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum Edit {
    /// The profile in force laid out again (its recipe changed): what it saves now.
    Saved {
        saved: Saved,
    },
    /// Another profile is in force: the windows it places nowhere go to the drawer, under their
    /// titles (by window id) at `now`.
    SwitchProfile {
        saved: Saved,
        #[serde(default)]
        titles: BTreeMap<String, String>,
        now: i64,
    },
    /// What `desk.shell.layouts`' session layer holds now: the layouts moved and the list.
    Moved {
        value: Value,
    },
    /// The moved desktops back as the profile saved them, and its list.
    Revert,
    /// The session record as it was saved (`restore` in `shell/link.ts`).
    Restore {
        #[serde(default)]
        desktop: Value,
        #[serde(default)]
        pan: Value,
        /// The drawer's items as saved: read one by one, those it cannot read left out.
        #[serde(default)]
        drawer: Value,
        #[serde(default)]
        slots: Value,
        now: i64,
    },
    /// The drawer's items (a seeded desk's); the windows some desktop places leave it.
    Drawer {
        items: Vec<DrawerItem>,
    },
    /// The runtime handed plugin `id`'s surface over, or let it go.
    Adopt {
        id: String,
        title: String,
    },
    Release {
        id: String,
    },
    /// Open window `id` on the desktop in front, at `placement` or its default place, focused.
    Open {
        id: String,
        #[serde(default)]
        placement: Option<Placement>,
    },
    /// Put `placement` on a desktop (the one in front when none) exactly as it is, last, in place of
    /// a window of its id there: a window that comes back (`desk.windows.reopen`).
    Place {
        #[serde(default)]
        desktop: Option<String>,
        placement: Placement,
    },
    /// Take window `id` out of a desktop's layout (the one in front when none); nothing unmounts.
    Unplace {
        #[serde(default)]
        desktop: Option<String>,
        id: String,
    },
    /// A window of the desktop in front with this whole geometry, as a gesture leaves it: a desk
    /// without the compositor's input (the runtime's fixture pages) moves a window this way.
    SetGeometry {
        geometry: Geometry,
    },
    ShowPlugin {
        id: String,
    },
    OpenView {
        view: String,
    },
    /// ⌘N: answers the new window's id.
    NewWindow,
    Focus {
        window: String,
        #[serde(default)]
        pane: Option<String>,
    },
    /// No window in use.
    Blur,
    /// The stop `step` places on in the focus order; answers it.
    FocusNext {
        step: i64,
    },
    Split {
        dir: SplitDir,
    },
    /// Answers the plugins to unmount.
    ClosePane {
        #[serde(default)]
        window: Option<String>,
        #[serde(default)]
        pane: Option<String>,
    },
    /// Answers the plugins to unmount.
    CloseWindow {
        id: String,
    },
    ShowInPane {
        window: String,
        pane: String,
        view: String,
    },
    ResizeSplit {
        window: String,
        split: String,
        ratio: f64,
    },
    TogglePin {
        id: String,
    },
    ToggleFloating {
        id: String,
    },
    PutAway {
        id: String,
        name: String,
        now: i64,
    },
    BringBack {
        item: String,
    },
    MoveEris {
        #[serde(default)]
        at: Option<Offset>,
    },
    /// Bring a desktop to the front: with the window it had in use (`switch-to`), or with none.
    SwitchTo {
        desktop: DesktopRef,
    },
    SetDesktop {
        desktop: DesktopRef,
    },
    StepDesktop {
        by: i64,
    },
    /// Answers the new desktop's id, or null at the cap.
    AddDesktop {
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        go: bool,
    },
    RenameDesktop {
        desktop: DesktopRef,
        name: String,
    },
    /// To position `at` (from 1), or by `by` places.
    ReorderDesktop {
        desktop: DesktopRef,
        #[serde(default)]
        at: Option<i64>,
        #[serde(default)]
        by: Option<i64>,
    },
    /// Answers `{ name, closed }` (the plugins to unmount), or null for the last desktop.
    RemoveDesktop {
        desktop: DesktopRef,
        windows: Windows,
    },
    /// Answers whether it moved; `before` is where it was before a drag that ended there.
    MoveToDesktop {
        window: String,
        desktop: DesktopRef,
        #[serde(default)]
        before: Option<Placement>,
    },
    /// To a new desktop at the end; answers whether it moved (false at the cap).
    MoveToNew {
        window: String,
        #[serde(default)]
        before: Option<Placement>,
    },
    /// The last move or removal taken back; answers whether there was one.
    UndoDesktop,
    /// The canvas of a desktop (the one in front when none) at `to`.
    Pan {
        #[serde(default)]
        desktop: Option<String>,
        to: Offset,
    },
    /// Tile or cascade the desktop in front; answers what it replaced (`Arranged`), or null.
    Arrange {
        kind: ArrangeKind,
        now: i64,
    },
    /// Put an arrangement back (`from`, an answer the undo stack kept, else the latest); answers
    /// what came back, or null.
    RestoreArrangement {
        #[serde(default)]
        from: Option<Arranged>,
    },
}

/// What the window manager keeps beside the `Desk` for the edits: the arrangements' history and
/// the desktops' undo stack, in memory as the runtime kept them.
#[derive(Clone, Debug, Default)]
pub struct Kept {
    pub arranger: Arranger,
    pub undo: Undo,
}

/// Apply `edit` to `desk` on a `screen`-sized app; what it answers.
pub fn apply(desk: &mut Desk, kept: &mut Kept, edit: &Edit, screen: Size) -> Value {
    match edit {
        Edit::Saved { saved } => desk.lay_out(saved.clone()),
        Edit::SwitchProfile { saved, titles, now } => {
            let title = |id: &str| titles.get(id).cloned().unwrap_or_else(|| id.to_string());
            desk.switch_profile(saved.clone(), title, *now);
        }
        Edit::Moved { value } => desk.take_moved(value),
        Edit::Revert => desk.revert(),
        Edit::Restore {
            desktop,
            pan,
            drawer,
            slots,
            now,
        } => desk.restore_session(desktop, pan, drawer, slots, *now),
        Edit::Drawer { items } => desk.set(|d| d.drawer = items.clone()),
        Edit::Adopt { id, title } => desk.adopt(id, title),
        Edit::Release { id } => desk.release(id),
        Edit::Open { id, placement } => desk.open_surface(id, placement.clone()),
        Edit::Place { desktop, placement } => {
            let at = desktop
                .as_deref()
                .map_or_else(|| desk.here(), |d| desk.id_of(d));
            desk.edit_at(at.as_str(), |l| {
                l.surfaces.retain(|p| p.id != placement.id);
                l.surfaces.push(placement.clone());
            });
        }
        Edit::Unplace { desktop, id } => {
            let at = desktop
                .as_deref()
                .map_or_else(|| desk.here(), |d| desk.id_of(d));
            desk.edit_at(at.as_str(), |l| l.surfaces.retain(|p| &p.id != id));
        }
        Edit::SetGeometry { geometry } => {
            let desktop = desk.here();
            let geometry = geometry.clone();
            Change::Window { desktop, geometry }.apply(desk);
        }
        Edit::ShowPlugin { id } => desk.show_plugin(id),
        Edit::OpenView { view } => desk.open_view(view),
        Edit::NewWindow => return json!(desk.new_window()),
        Edit::Focus { window, pane } => desk.focus_pane(window, pane.as_deref()),
        Edit::Blur => desk.set(|d| {
            d.focused = None;
            d.pane = None;
        }),
        Edit::FocusNext { step } => return json!(desk.focus_next(*step)),
        Edit::Split { dir } => desk.split(*dir),
        Edit::ClosePane { window, pane } => {
            let plugins = desk.close_pane(window.as_deref(), pane.as_deref());
            return released(desk, plugins);
        }
        Edit::CloseWindow { id } => {
            let plugins = desk.close_window(id);
            return released(desk, plugins);
        }
        Edit::ShowInPane { window, pane, view } => desk.show_in_pane(window, pane, view),
        Edit::ResizeSplit {
            window,
            split,
            ratio,
        } => desk.resize_split(window, split, *ratio),
        Edit::TogglePin { id } => desk.toggle_pin(id),
        Edit::ToggleFloating { id } => desk.toggle_floating(id, screen.w, screen.h),
        Edit::PutAway { id, name, now } => desk.put_away(id, name, *now),
        Edit::BringBack { item } => desk.bring_back(item),
        Edit::MoveEris { at } => desk.move_eris(*at),
        Edit::SwitchTo { desktop } => desk.switch_to(desktop.clone()),
        Edit::SetDesktop { desktop } => desk.set_desktop(desktop.clone()),
        Edit::StepDesktop { by } => desk.step_desktop(*by),
        Edit::AddDesktop { name, go } => {
            let id = desk.add_desktop(name.as_deref());
            if let (Some(id), true) = (&id, go) {
                desk.switch_to(id.as_str());
            }
            return json!(id);
        }
        Edit::RenameDesktop { desktop, name } => desk.rename_desktop(desktop.clone(), name),
        Edit::ReorderDesktop { desktop, at, by } => {
            let id = desk.id_of(desktop.clone());
            let here = crate::desktops::position_of(desk.desktops(), &id) as i64;
            let to = at.unwrap_or(here + by.unwrap_or(0));
            desk.reorder_desktop(id.as_str(), to);
        }
        Edit::RemoveDesktop { desktop, windows } => {
            return kept.undo.remove(desk, desktop.clone(), *windows);
        }
        Edit::MoveToDesktop {
            window,
            desktop,
            before,
        } => {
            return json!(
                kept.undo
                    .move_to(desk, window, desktop.clone(), before.as_ref())
            );
        }
        Edit::MoveToNew { window, before } => {
            let Some(id) = desk.add_desktop(None) else {
                return json!(false);
            };
            return json!(kept.undo.move_to(desk, window, id.into(), before.as_ref()));
        }
        Edit::UndoDesktop => return json!(kept.undo.undo(desk)),
        Edit::Pan { desktop, to } => {
            let id = desktop
                .as_deref()
                .map_or_else(|| desk.here(), |d| desk.id_of(d));
            desk.pan.insert(id, *to);
        }
        Edit::Arrange { kind, now } => {
            let arranged = kept
                .arranger
                .arrange(desk, *kind, screen.w, screen.h, GAP, *now);
            return json!(arranged);
        }
        Edit::RestoreArrangement { from } => {
            return json!(kept.arranger.restore(desk, from.as_ref()));
        }
    }
    Value::Null
}

/// A closed window's plugins unmount for the session (ADR 0040): they are let go here at once, so
/// the desk published with the close never shows them back in their slots, and answered for the
/// runtime to unmount (its own `release` then changes nothing).
pub(crate) fn released(desk: &mut Desk, plugins: Vec<String>) -> Value {
    for plugin in &plugins {
        desk.release(plugin);
    }
    json!(plugins)
}

impl From<Windows> for OnRemove {
    fn from(w: Windows) -> Self {
        match w {
            Windows::Move => OnRemove::Move,
            Windows::Close => OnRemove::Close,
        }
    }
}
