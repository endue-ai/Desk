//! Where plugin windows go when no profile places them (`packages/runtime/src/surface/tiling.ts`,
//! ADR 0040): each into its own slot, given when the runtime hands its surface over and kept while
//! it stays mounted. A slot's rect never depends on the other windows, so a window never moves or
//! resizes because another one arrived, moved or closed. Six slots of one size fill the free area
//! of the app as it was when the window arrived (#158), three by two in reading order; the next six
//! cascade over them, and the six after those again, the room for both steps kept inside the area
//! so that no window reaches past the side bars or under the dock. The nineteenth starts over.

use crate::coordinates::ORIGIN;
use crate::geometry::{FREE, MIN};
use crate::types::{Adopted, PaneNode, Placement, Rect};

/// Between slots, and the arranged grid's default gap.
pub const GAP: f64 = 12.0;
const COLS: usize = 3;
const ROWS: usize = 2;
/// How far each further six step down and right over the first; also the arranged cascade's step.
pub const CASCADE: f64 = 32.0;
/// How many sixes cascade before the next one starts over the first.
const LAYERS: usize = 3;

/// The rect of slot `n` (from 0) in the reference frame's free area.
pub fn slot_rect(n: usize) -> Rect {
    slot_rect_in(n, FREE)
}

/// Cell `i` of `count` along `length` from `from`, room left for the cascade's steps: its start and
/// size, and the step each further six takes. A cell under `least` keeps `least`, and the cells
/// overlap then rather than leave the area.
fn cell(from: f64, length: f64, count: usize, i: usize, least: f64) -> (f64, f64, f64) {
    let steps = (LAYERS - 1) as f64;
    let room = length - CASCADE * steps;
    let gaps = GAP * (count - 1) as f64;
    let size = least.max(((room - gaps) / count as f64).floor());
    let pitch = if count > 1 {
        (size + GAP).min(((room - size) / (count - 1) as f64).floor().max(0.0))
    } else {
        0.0
    };
    let left = length - size - pitch * (count - 1) as f64;
    let step = CASCADE.min((left / steps).floor().max(0.0));
    (from + i as f64 * pitch, size, step)
}

/// The rect of slot `n` (from 0) in `area`.
pub fn slot_rect_in(n: usize, area: Rect) -> Rect {
    let i = n % (COLS * ROWS);
    let layer = ((n / (COLS * ROWS)) % LAYERS) as f64;
    let (x, w, dx) = cell(area.x, area.w, COLS, i % COLS, MIN.w);
    let (y, h, dy) = cell(area.y, area.h, ROWS, i / COLS, MIN.h);
    Rect::new(x + layer * dx, y + layer * dy, w, h)
}

/// The first slot none of `taken` holds.
pub fn free_slot(taken: impl IntoIterator<Item = usize>) -> usize {
    let held: std::collections::BTreeSet<usize> = taken.into_iter().collect();
    (0..).find(|n| !held.contains(n)).unwrap_or(0)
}

/// The windows of plugin surfaces no layout places (`autoPlacements`), each in its slot: its own,
/// or its place in `adopted`, in the free area it arrived in. A normal window, at its slot on
/// screen as the canvas was when it arrived. `skip` names the plugins that have a window
/// elsewhere: placed by the desktop's layout, in the drawer or on another desktop (the desk state
/// decides, #79).
pub fn slot_windows(adopted: &[Adopted], skip: impl Fn(&str) -> bool) -> Vec<Placement> {
    adopted
        .iter()
        .enumerate()
        .filter(|(_, a)| !skip(&a.id))
        .map(|(i, a)| {
            let rect = slot_rect_in(a.slot.unwrap_or(i), a.area.unwrap_or(FREE));
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
        assert_eq!(slot_rect(0), Rect::new(104.0, 190.0, 381.0, 261.0));
        assert_eq!(slot_rect(1), Rect::new(497.0, 190.0, 381.0, 261.0));
        assert_eq!(slot_rect(3), Rect::new(104.0, 463.0, 381.0, 261.0));
    }

    #[test]
    fn the_third_six_ends_at_the_areas_edges_and_the_fourth_starts_over() {
        let last = slot_rect(17);
        assert!(last.right() <= FREE.right() && last.right() > FREE.right() - 3.0);
        assert_eq!(last.bottom(), FREE.bottom());
        assert_eq!(slot_rect(18), slot_rect(0));
    }

    #[test]
    fn in_an_area_too_small_for_the_minimum_the_slots_keep_it_and_overlap() {
        let area = Rect::new(104.0, 190.0, 600.0, 200.0);
        let r = slot_rect_in(5, area);
        assert_eq!((r.w, r.h), (MIN.w, MIN.h));
        assert!(r.right() <= area.right() && r.x >= area.x);
    }

    #[test]
    fn a_skipped_plugin_keeps_the_others_slots_where_they_were() {
        let adopted = ["a", "b", "c"].map(|id| Adopted {
            id: id.into(),
            title: id.into(),
            slot: None,
            at: None,
            area: None,
        });
        let windows = slot_windows(&adopted, |id| id == "b");
        let ids: Vec<&str> = windows.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, ["a", "c"]);
        assert_eq!(windows[1].rect(), slot_rect(2));
        assert_eq!(windows[1].panes, Some(PaneNode::view("p1", "plugin:c")));
    }
}
