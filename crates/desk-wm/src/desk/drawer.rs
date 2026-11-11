//! The drawer against the desktops (`packages/runtime/src/shell/away.ts`; `stash`, `raise` and
//! `switched` in `shell/actions.ts`). The drawer holds only what is away (#4): after every change
//! a window some desktop's layout places leaves it, so a profile switched back to, a restored
//! session or a layout set from settings leave it right without each saying so. Putting away
//! takes the window's title from the caller (the shell's copy) and the time from its clock.

use std::collections::BTreeSet;

use crate::desktops::id_at;
use crate::drawer::{DrawerItem, DrawerKind};
use crate::layout::Saved;
use crate::placed::PLUGIN_VIEW;
use crate::types::Placement;

use super::Desk;

impl Desk {
    /// The drawer without the windows some desktop places (`keepAway`).
    pub(crate) fn keep_away(&mut self) {
        if !self.drawer.iter().any(|d| d.placement.is_some()) {
            return;
        }
        let placed: BTreeSet<String> = self
            .desktops()
            .iter()
            .flat_map(|d| self.layout_of(d.id.as_str()).surfaces)
            .map(|p| p.id)
            .collect();
        self.drawer
            .retain(|d| d.placement.as_ref().is_none_or(|p| !placed.contains(&p.id)));
    }

    /// Put a window of the desktop in front away (`stash`) under `name`, at wall-clock `now`: it
    /// leaves the layout and goes first in the drawer, where it is once.
    pub fn put_away(&mut self, id: &str, name: &str, now: i64) {
        self.ensure_placed(id);
        let Some(placement) = self.layout().surfaces.into_iter().find(|p| p.id == id) else {
            return;
        };
        self.close_surface(id);
        self.drawer
            .retain(|d| d.placement.as_ref().is_none_or(|p| p.id != id));
        self.drawer.insert(
            0,
            DrawerItem {
                id: format!("surface-{id}"),
                kind: DrawerKind::Surface,
                name: name.to_string(),
                at: now,
                placement: Some(placement),
            },
        );
        self.keep_away();
    }

    /// Bring a drawer item back (`raise`) on the desktop in front, focused: a put-away window where
    /// it was, a recent item as Eris's screen, a file as its view.
    pub fn bring_back(&mut self, item: &str) {
        let Some(at) = self.drawer.iter().position(|d| d.id == item) else {
            return;
        };
        let item = self.drawer.remove(at);
        self.open_surface(&item.window(), item.placement);
    }

    /// Another profile is in force (`switched`): the windows it places on none of its desktops go
    /// to the drawer instead of closing, under `title(id)` at wall-clock `now`, and the desktops
    /// moved under the last one are dropped. Two kinds never go there, as they come back by
    /// themselves (#158): the last profile's own windows leave with it, from the desktops and from
    /// the drawer (it lays them out again when it is back), and a plugin's own window goes back to
    /// its slot. The desk stays on the same desktop when the next profile has it, else on the same
    /// position, and the next profile's windows there open in front, the last one in use.
    pub fn switch_profile(&mut self, next: Saved, title: impl Fn(&str) -> String, now: i64) {
        let kept: BTreeSet<&str> = next.placed().collect();
        let leaving: BTreeSet<String> = self.saved.placed().map(String::from).collect();
        let mut seen: BTreeSet<String> = BTreeSet::new();
        let sent: Vec<Placement> = self
            .desktops()
            .iter()
            .flat_map(|d| self.layout_of(d.id.as_str()).surfaces)
            .filter(|p| {
                !kept.contains(p.id.as_str())
                    && !leaving.contains(&p.id)
                    && !own_window(p)
                    && seen.insert(p.id.clone())
            })
            .collect();
        let here = self.here();
        let position = self
            .desktops()
            .iter()
            .position(|d| d.id == here)
            .map_or(0, |i| i + 1);
        let list = &next.list;
        let desktop = id_at(list, &here.as_str().into())
            .or_else(|| id_at(list, &position.min(list.len()).into()))
            .unwrap_or(here);
        let items = sent.into_iter().map(|p| DrawerItem {
            id: format!("surface-{}", p.id),
            kind: DrawerKind::Surface,
            name: title(&p.id),
            at: now,
            placement: Some(p),
        });
        let mut drawer: Vec<DrawerItem> = items.collect();
        let sent_ids: BTreeSet<String> = drawer
            .iter()
            .filter_map(|d| d.placement.as_ref().map(|p| p.id.clone()))
            .collect();
        drawer.extend(self.drawer.drain(..).filter(|d| {
            d.placement
                .as_ref()
                .is_none_or(|p| !sent_ids.contains(&p.id) && !leaving.contains(&p.id))
        }));
        self.saved = next;
        self.session.clear();
        self.desktops = None;
        self.desktop = desktop;
        self.drawer = drawer;
        self.keep_away();
        self.use_arrived();
    }

    /// The next profile's windows count as used (ADR 0168), in its order, so on each desktop they
    /// stack in front of the windows that were there: those of the other desktops first, then
    /// those of the desktop in front, each taking the focus in turn; the last one stays in use.
    fn use_arrived(&mut self) {
        let here = self.here();
        let drawn = |desk: &Desk, desktop: &str| -> Vec<String> {
            let shown: BTreeSet<String> =
                desk.windows_of(desktop).into_iter().map(|p| p.id).collect();
            (desk.layout_of(desktop).surfaces.into_iter())
                .map(|p| p.id)
                .filter(|id| shown.contains(id))
                .collect()
        };
        let others: Vec<String> = (self.desktops().iter())
            .filter(|d| d.id != here)
            .flat_map(|d| drawn(self, d.id.as_str()))
            .collect();
        for id in others {
            self.used.touch(&id);
        }
        for id in drawn(self, here.as_str()) {
            self.focus_pane(&id, None);
        }
    }
}

/// A plugin's own window: named after its plugin and showing nothing else. Its plugin's slot
/// shows it again once no layout places it, so a profile switch need not keep it in the drawer.
fn own_window(p: &Placement) -> bool {
    p.id == p.plugin
        && p.panes().leaves().into_iter().all(|(_, view)| {
            view == p.id || view.strip_prefix(PLUGIN_VIEW) == Some(p.plugin.as_str())
        })
}
