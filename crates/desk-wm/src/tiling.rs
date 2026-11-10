//! Where plugin windows go when no profile places them (`packages/runtime/src/surface/tiling.ts`,
//! ADR 0040): each into its own slot, given when the runtime hands its surface over and kept while
//! it stays mounted. A slot's rect never depends on the other windows, so a window never moves or
//! resizes because another one arrived, moved or closed. Six slots of one size fill the free area,
//! three by two in reading order; the next six cascade over them.

use crate::coordinates::ORIGIN;
use crate::geometry::FREE;
use crate::types::{Adopted, PaneNode, Placement, Rect};

/// Between slots, and the arranged grid's default gap.
pub const GAP: f64 = 12.0;
const COLS: usize = 3;
const ROWS: usize = 2;
/// How far each further six step down and right over the first; also the arranged cascade's step.
pub const CASCADE: f64 = 32.0;

/// The rect of slot `n` (from 0) in the free area.
pub fn slot_rect(n: usize) -> Rect {
    slot_rect_in(n, FREE)
}

/// The rect of slot `n` (from 0) in `area`.
pub fn slot_rect_in(n: usize, area: Rect) -> Rect {
    let w = ((area.w - GAP * (COLS - 1) as f64) / COLS as f64).floor();
    let h = ((area.h - GAP * (ROWS - 1) as f64) / ROWS as f64).floor();
    let i = n % (COLS * ROWS);
    let step = (n / (COLS * ROWS)) as f64 * CASCADE;
    Rect::new(
        area.x + (i % COLS) as f64 * (w + GAP) + step,
        area.y + (i / COLS) as f64 * (h + GAP) + step,
        w,
        h,
    )
}

/// The first slot none of `taken` holds.
pub fn free_slot(taken: impl IntoIterator<Item = usize>) -> usize {
    let held: std::collections::BTreeSet<usize> = taken.into_iter().collect();
    (0..).find(|n| !held.contains(n)).unwrap_or(0)
}

/// The windows of plugin surfaces no layout places (`autoPlacements`), each in its slot: its own,
/// or its place in `adopted`. A normal window, at its slot on screen as the canvas was when it
/// arrived. `skip` names the plugins that have a window elsewhere: placed by the desktop's layout,
/// in the drawer or on another desktop (the desk state decides, #79).
pub fn slot_windows(adopted: &[Adopted], skip: impl Fn(&str) -> bool) -> Vec<Placement> {
    adopted
        .iter()
        .enumerate()
        .filter(|(_, a)| !skip(&a.id))
        .map(|(i, a)| {
            let rect = slot_rect(a.slot.unwrap_or(i));
            let at = a.at.unwrap_or(ORIGIN);
            let mut p = Placement::new(
                a.id.clone(),
                a.id.clone(),
                Rect::new(rect.x - at.x, rect.y - at.y, rect.w, rect.h),
            );
            p.panes = Some(PaneNode::view("p1", format!("plugin:{}", a.id)));
            p
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_slots_sit_at_the_free_areas_top_left_three_to_a_row() {
        assert_eq!(slot_rect(0), Rect::new(104.0, 190.0, 402.0, 305.0));
        assert_eq!(slot_rect(1), Rect::new(518.0, 190.0, 402.0, 305.0));
        assert_eq!(slot_rect(3), Rect::new(104.0, 507.0, 402.0, 305.0));
    }

    #[test]
    fn a_skipped_plugin_keeps_the_others_slots_where_they_were() {
        let adopted = ["a", "b", "c"].map(|id| Adopted {
            id: id.into(),
            title: id.into(),
            slot: None,
            at: None,
        });
        let windows = slot_windows(&adopted, |id| id == "b");
        let ids: Vec<&str> = windows.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, ["a", "c"]);
        assert_eq!(windows[1].rect(), slot_rect(2));
        assert_eq!(windows[1].panes, Some(PaneNode::view("p1", "plugin:c")));
    }
}
