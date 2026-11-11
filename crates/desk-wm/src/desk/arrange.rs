//! Tile and cascade over the `Desk` (ADR 0116; `packages/runtime/src/arrange/arranger.ts`, which
//! `arrange/commands.ts` runs as `desk.windows.tile`, `cascade` and `restore-arrangement`): which
//! windows they move, one session edit of the desktop in front for the lot, and a history per
//! desktop of the geometry they replaced, which a restore and the desk's undo (ADR 0077) put back.
//! The history is in memory, as the core's undo stack is; the entry ids take the caller's clock.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::arrange::{arrange_area, cascade_rects, tile_rects};
use crate::desktops::DesktopId;
use crate::layout::DesktopLayout;
use crate::tiling::CASCADE;
use crate::types::{Fill, Placement, Rect, Restore};

use super::Desk;

/// How many arrangements each desktop remembers.
pub const HISTORY: usize = 20;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArrangeKind {
    Tile,
    Cascade,
}

/// A window's geometry as an arrangement found it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Kept {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Fill>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restore: Option<Restore>,
}

/// What an arrangement answers: the undo stack keeps it and hands it back to the restore.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Arranged {
    pub desktop: DesktopId,
    pub entry: String,
    pub kind: ArrangeKind,
    pub windows: Vec<Kept>,
}

/// What a restore put back.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Restored {
    pub desktop: DesktopId,
    pub entry: String,
    pub windows: usize,
}

#[derive(Clone, Debug, PartialEq)]
struct Entry {
    arranged: Arranged,
    /// The desktop's session layer before, `None` when it had none.
    session: Option<DesktopLayout>,
    /// The desktop's layout right after, to tell whether anything changed since; `None` for one
    /// rebuilt from an answer.
    after: Option<DesktopLayout>,
}

/// The arrangements made, per desktop by its stable id, and those already put back.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Arranger {
    history: BTreeMap<DesktopId, Vec<Entry>>,
    restored: BTreeSet<String>,
    count: u64,
}

fn keep(p: &Placement) -> Kept {
    Kept {
        id: p.id.clone(),
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        fill: p.fill,
        restore: p.restore,
    }
}

/// `p` at `rect` on the canvas, filling nothing any more.
fn placed(p: &Placement, rect: Rect) -> Placement {
    let mut out = Placement {
        fill: None,
        restore: None,
        ..p.clone()
    };
    out.set_rect(rect);
    out
}

/// `p` back at the geometry an arrangement kept.
fn back(p: &Placement, k: &Kept) -> Placement {
    Placement {
        x: k.x,
        y: k.y,
        w: k.w,
        h: k.h,
        fill: k.fill,
        restore: k.restore,
        ..p.clone()
    }
}

impl Arranger {
    /// Lay out the normal, unpinned windows of the desktop in front, on a `vw`×`vh` app with tiles
    /// `gap` apart, as one session edit; `now` (wall-clock milliseconds) names the entry. `None`
    /// when there is no window to move.
    pub fn arrange(
        &mut self,
        desk: &mut Desk,
        kind: ArrangeKind,
        vw: f64,
        vh: f64,
        gap: f64,
        now: i64,
    ) -> Option<Arranged> {
        let movable = desk
            .windows()
            .into_iter()
            .filter(|p| p.floating != Some(true) && !p.pinned);
        // A grid reads in desk order; a cascade lays the windows out back to front as they stack
        // (`cover.rs`), so the window in use ends last, on top, and the stacking stays.
        let windows: Vec<Placement> = match kind {
            ArrangeKind::Tile => movable.collect(),
            ArrangeKind::Cascade => {
                let movable: Vec<Placement> = movable.collect();
                let stack = desk.used.stack(&movable, desk.focused.as_deref());
                stack.into_iter().map(|(_, p)| p.clone()).collect()
            }
        };
        if windows.is_empty() {
            return None;
        }
        let desktop = desk.here();
        let layout = desk.layout_of(desktop.as_str());
        let area = arrange_area(vw, vh, layout.eris.is_none());
        let rects = match kind {
            ArrangeKind::Tile => tile_rects(windows.len(), area, gap),
            ArrangeKind::Cascade => cascade_rects(windows.len(), area, CASCADE),
        };
        let pan = desk.pan_of(&desktop);
        let before = desk.session.get(&desktop).cloned();
        // The arranged windows go last, in the order they took their places, so the windows never
        // in use stack as the cascade lays them out too; a plugin window no layout placed yet
        // enters it here.
        let moved: Vec<Placement> = windows
            .iter()
            .zip(rects.iter().chain(std::iter::repeat(&area)))
            .map(|(p, r)| {
                let own = layout.surfaces.iter().find(|q| q.id == p.id).unwrap_or(p);
                placed(own, Rect::new(r.x - pan.x, r.y - pan.y, r.w, r.h))
            })
            .collect();
        desk.edit_at(desktop.as_str(), |l| {
            l.surfaces.retain(|p| !windows.iter().any(|w| w.id == p.id));
            l.surfaces.extend(moved);
        });
        self.count += 1;
        let kind_name = match kind {
            ArrangeKind::Tile => "tile",
            ArrangeKind::Cascade => "cascade",
        };
        let arranged = Arranged {
            desktop: desktop.clone(),
            entry: format!("{kind_name}-{now}-{}", self.count),
            kind,
            windows: windows.iter().map(keep).collect(),
        };
        let entry = Entry {
            arranged: arranged.clone(),
            session: before,
            after: Some(desk.layout_of(desktop.as_str())),
        };
        let list = self.history.entry(desktop).or_default();
        list.push(entry);
        if list.len() > HISTORY {
            list.remove(0);
        }
        Some(arranged)
    }

    /// Whether a desktop (the one in front when `None`) has an arrangement to put back.
    pub fn can_restore(&self, desk: &Desk, desktop: Option<&str>) -> bool {
        let id = desktop.map_or_else(|| desk.here(), String::from);
        self.history.get(&id).is_some_and(|l| !l.is_empty())
    }

    /// Put an arrangement back: the one an undo names (`from`, an arrangement's answer), else the
    /// latest of the desktop in front. When nothing changed on its desktop since, the desktop comes
    /// back exactly, unsaved edits included; otherwise each window still there takes its kept
    /// geometry. `None` when there was nothing, or the one named was put back already.
    pub fn restore(&mut self, desk: &mut Desk, from: Option<&Arranged>) -> Option<Restored> {
        let entry = match from {
            Some(named) => self.take(named)?,
            None => self.history.get_mut(&desk.here())?.pop()?,
        };
        let Arranged {
            desktop,
            entry: id,
            windows,
            ..
        } = &entry.arranged;
        self.restored.insert(id.clone());
        let now = desk.layout_of(desktop.as_str());
        if entry.after.as_ref() == Some(&now) {
            match &entry.session {
                Some(layout) => desk.session.insert(desktop.clone(), layout.clone()),
                None => desk.session.remove(desktop),
            };
            desk.set(|_| {});
        } else {
            desk.edit_at(desktop.as_str(), |l| {
                for p in &mut l.surfaces {
                    if let Some(k) = windows.iter().find(|k| k.id == p.id) {
                        *p = back(p, k);
                    }
                }
            });
        }
        Some(Restored {
            desktop: desktop.clone(),
            entry: id.clone(),
            windows: windows.len(),
        })
    }

    /// The entry an undo names, out of its desktop's history. One this desk no longer holds (the
    /// page was reloaded under a core that kept its undo stack) comes back from the answer itself,
    /// its geometry only; one already put back does nothing.
    fn take(&mut self, from: &Arranged) -> Option<Entry> {
        if self.restored.contains(&from.entry) {
            return None;
        }
        for list in self.history.values_mut() {
            if let Some(at) = list.iter().position(|e| e.arranged.entry == from.entry) {
                return Some(list.remove(at));
            }
        }
        Some(Entry {
            arranged: from.clone(),
            session: None,
            after: None,
        })
    }
}
