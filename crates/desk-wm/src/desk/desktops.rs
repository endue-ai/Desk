//! The desktops' list changes as changes of the `Desk` (ADR 0117;
//! `packages/runtime/src/desktops/ops.ts`): add, rename, remove and reorder. They are unsaved
//! changes to the profile in force, like moved windows: saving keeps them, reverting drops them.
//! Every desktop keeps its own layout, pan and window in use.

use crate::desktops::{
    Desktop, DesktopId, DesktopRef, added, id_at, moved, neighbour_of, removed, renamed,
};
use crate::types::Placement;

use super::Desk;

/// What becomes of a removed desktop's windows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OnRemove {
    /// They move to its neighbour, at the same place on screen.
    Move,
    /// They close: the caller unmounts the plugins they show.
    Close,
}

/// A desktop removed: where its windows went, or the windows that closed.
#[derive(Clone, Debug, PartialEq)]
pub struct Removal {
    pub into: DesktopId,
    pub closed: Vec<Placement>,
}

impl Desk {
    /// The list as the desk keeps it: `None` once it is the profile's own again.
    fn set_list(&mut self, list: Vec<Desktop>) {
        self.desktops = (list != self.saved.list).then_some(list);
        self.keep_away();
    }

    /// Ids a new desktop must not take: any a layout, a pan or a kept focus still names.
    fn taken(&self) -> Vec<String> {
        let saved = &self.saved;
        saved
            .list
            .iter()
            .map(|d| d.id.clone())
            .chain(saved.desktops.keys().cloned())
            .chain(self.session.keys().cloned())
            .chain(self.pan.keys().cloned())
            .chain(self.focus_by.keys().cloned())
            .collect()
    }

    /// A new desktop at the end of the list, named `name` or the first free number; its id, or
    /// `None` at the cap.
    pub fn add_desktop(&mut self, name: Option<&str>) -> Option<DesktopId> {
        let (list, id) = added(self.desktops(), self.taken(), name)?;
        self.set_list(list);
        Some(id)
    }

    /// Rename a desktop; an empty name keeps the old one.
    pub fn rename_desktop(&mut self, r: impl Into<DesktopRef>, name: &str) {
        if let Some(id) = id_at(self.desktops(), &r.into()) {
            let list = renamed(self.desktops(), &id, name);
            self.set_list(list);
        }
    }

    /// Move a desktop to position `to` (from 1).
    pub fn reorder_desktop(&mut self, r: impl Into<DesktopRef>, to: i64) {
        if let Some(id) = id_at(self.desktops(), &r.into()) {
            let list = moved(self.desktops(), &id, to);
            self.set_list(list);
        }
    }

    /// The first empty desktop besides the one in front.
    pub fn empty_desktop(&self) -> Option<DesktopId> {
        let here = self.here();
        self.desktops()
            .iter()
            .find(|d| d.id != here && self.desktop_is_empty(d.id.as_str()))
            .map(|d| d.id.clone())
    }

    /// Remove a desktop. Its windows move to its neighbour (the desktop before it, or after it
    /// when it is first) at the same place on screen, or close; the desk goes to the neighbour when
    /// it was in front. The last desktop stays (`None`).
    pub fn remove_desktop(
        &mut self,
        r: impl Into<DesktopRef>,
        windows: OnRemove,
    ) -> Option<Removal> {
        let list = self.desktops().to_vec();
        let id = id_at(&list, &r.into())?;
        let into = neighbour_of(&list, &id)?;
        if list.len() <= 1 {
            return None;
        }
        let own = self.layout_of(id.as_str()).surfaces;
        if windows == OnRemove::Move && !own.is_empty() {
            let mut there = self.layout_of(into.as_str());
            let arriving: Vec<Placement> =
                own.iter().map(|p| self.on_screen(p, &id, &into)).collect();
            there
                .surfaces
                .retain(|p| !arriving.iter().any(|a| a.id == p.id));
            there.surfaces.extend(arriving);
            self.session.insert(into.clone(), there);
        }
        self.session.remove(&id);
        self.pan.remove(&id);
        let kept = self.focus_by.remove(&id);
        let here = self.here() == id;
        if windows == OnRemove::Move
            && !here
            && let Some(kept) = kept
        {
            self.focus_by.entry(into.clone()).or_insert(kept);
        }
        if here {
            self.desktop = into.clone();
            if windows == OnRemove::Close {
                self.focused = None;
                self.pane = None;
            }
        }
        self.set_list(removed(&list, &id));
        let closed = match windows {
            OnRemove::Close => own,
            OnRemove::Move => Vec::new(),
        };
        Some(Removal { into, closed })
    }
}
