//! Ported from `packages/runtime/src/surface/cover.test.ts`: which plugin windows nobody can see
//! (ADR 0070), wholly under windows drawn above them or off the screen. The runtime unloads those
//! frames after `desk.display.unload-after`. Also `shell/windows.test.ts`'s stacking case, the one
//! about `zOf`.
//!
//! The TS cases build the shell's store and ask the host (`surface/host.ts`); here the same desk is
//! built from its parts as `windows_of` lays them out: the plugin windows in their slots, then the
//! layout's windows over them (#158).
//!
//! Not ported: "tells the runtime after the store changes, once the windows are drawn" is the
//! host's wiring (a store watch and a microtask), not the model's. The host on the compositor
//! (#81) tells the live budget after it has drawn.

use std::collections::BTreeSet;

use desk_wm::cover::UseOrder;
use desk_wm::{
    Adopted, Fill, Offset, PaneNode, Placement, Rect, covered_plugins, shown_plugins, slot_windows,
    z_of,
};

const A: &str = "a.one";
const B: &str = "b.two";

/// A shell window of its own (a launcher) at x, y, w × h in the 1440 × 900 frame.
fn window(id: &str, x: f64, y: f64, w: f64, h: f64) -> Placement {
    let mut p = Placement::new(id, "endue.window", Rect::new(x, y, w, h));
    p.panes = Some(PaneNode::view("p1", "launcher"));
    p
}

/// Two plugin windows in slots 0 and 1 (104..506 and 518..920, 190..495), plus `windows`.
struct Desk {
    layout: Vec<Placement>,
    adopted: Vec<Adopted>,
    focused: Option<String>,
    pan: Offset,
}

fn desk(windows: Vec<Placement>, focused: Option<&str>) -> Desk {
    let adopted = [(A, "One"), (B, "Two")]
        .map(|(id, title)| Adopted {
            id: id.into(),
            title: title.into(),
            slot: None,
            at: None,
        })
        .to_vec();
    Desk {
        layout: windows,
        adopted,
        focused: focused.map(String::from),
        pan: Offset::new(0.0, 0.0),
    }
}

impl Desk {
    /// What `host.covered(id)` answered, at the runtime's 1440 × 900 without a DOM.
    fn covered(&self, id: &str) -> bool {
        let placed: BTreeSet<&str> = self.layout.iter().map(|p| p.plugin.as_str()).collect();
        let mut windows = slot_windows(&self.adopted, |id| placed.contains(id));
        windows.extend(self.layout.iter().cloned());
        let adopted = |plugin: &str| self.adopted.iter().any(|a| a.id == plugin);
        let levels = UseOrder::default().levels(&windows, self.focused.as_deref());
        let hidden = covered_plugins(
            &windows,
            &levels,
            |p| shown_plugins(p, adopted),
            self.pan,
            1440.0,
            900.0,
        );
        hidden.contains(id)
    }
}

mod covered_plugin_windows {
    use super::*;

    #[test]
    fn tiled_side_by_side_neither_is_covered() {
        let d = desk(vec![], None);
        assert!(!d.covered(A));
        assert!(!d.covered(B));
    }

    #[test]
    fn a_window_drawn_above_that_fills_the_free_area_covers_both() {
        let d = desk(
            vec![window("big", 104.0, 190.0, 1232.0, 622.0)],
            Some("big"),
        );
        assert!(d.covered(A));
        assert!(d.covered(B));
    }

    #[test]
    fn one_that_covers_only_part_of_a_window_leaves_it_visible() {
        let d = desk(
            vec![window("half", 104.0, 190.0, 400.0, 622.0)],
            Some("half"),
        );
        assert!(!d.covered(A));
    }

    #[test]
    fn a_window_of_the_layout_lies_over_the_tiled_plugin_windows_even_out_of_focus() {
        let d = desk(vec![window("over", 104.0, 190.0, 1232.0, 622.0)], None);
        assert!(d.covered(A));
        assert!(d.covered(B));
    }

    #[test]
    fn two_pinned_windows_that_cover_it_together_cover_it() {
        // Pinned windows are drawn above the tiled plugin windows, as the layout's others are.
        let left = Placement {
            pinned: true,
            ..window("left", 104.0, 190.0, 320.0, 622.0)
        };
        let right = Placement {
            pinned: true,
            ..window("right", 420.0, 190.0, 300.0, 622.0)
        };
        let d = desk(vec![left, right], None);
        assert!(d.covered(A));
        assert!(!d.covered(B));
    }

    #[test]
    fn the_window_in_focus_is_drawn_on_top_so_nothing_covers_it() {
        let big = Placement {
            pinned: true,
            ..window("big", 104.0, 190.0, 1232.0, 622.0)
        };
        let d = desk(vec![big], Some(A));
        assert!(!d.covered(A));
        assert!(d.covered(B));
    }

    #[test]
    fn a_canvas_window_panned_off_the_screen_is_not_visible() {
        // In focus, so the tiled window beside it does not cover it once it is back in sight.
        let away = Placement {
            plugin: A.into(),
            floating: Some(false),
            panes: None,
            ..window(A, 104.0, 190.0, 400.0, 300.0)
        };
        let mut d = desk(vec![away], Some(A));
        d.pan = Offset::new(-4000.0, 0.0);
        assert!(d.covered(A));
        d.pan = Offset::new(0.0, 0.0);
        assert!(!d.covered(A));
    }
}

mod the_stacking_order {
    use super::*;

    fn at(id: &str) -> Placement {
        Placement::new(id, "x", Rect::new(0.0, 0.0, 1.0, 1.0))
    }

    /// `windows`' ids front to back, `focused` in use.
    fn front_to_back(used: &UseOrder, windows: &[Placement], focused: Option<&str>) -> Vec<String> {
        let mut ids: Vec<String> = (used.stack(windows, focused).into_iter())
            .map(|(_, p)| p.id.clone())
            .collect();
        ids.reverse();
        ids
    }

    #[test]
    fn answers_a_history_of_focuses_most_recent_first() {
        let windows = [at("a"), at("b"), at("c"), at("d")];
        let mut used = UseOrder::default();
        for id in ["d", "a", "c", "a", "b"] {
            used.touch(id);
        }
        assert_eq!(
            front_to_back(&used, &windows, Some("b")),
            ["b", "a", "c", "d"]
        );
        // The ranks are places from the back, whatever the desk order.
        assert_eq!(used.ranks(&windows), [2, 3, 1, 0]);
        let levels = used.levels(&windows, Some("b"));
        assert!(levels[1] > levels[0] && levels[0] > levels[2] && levels[2] > levels[3]);
    }

    #[test]
    fn puts_the_windows_never_in_use_under_the_others_in_desk_order() {
        let windows = [at("a"), at("b"), at("c"), at("d")];
        let mut used = UseOrder::default();
        used.touch("a");
        assert_eq!(front_to_back(&used, &windows, None), ["a", "d", "c", "b"]);
    }

    #[test]
    fn keeps_a_fill_never_in_use_above_the_canvas_windows_never_in_use_as_a_restored_desk_had_it() {
        let filled = Placement {
            floating: Some(true),
            fill: Some(Fill::Full),
            ..at("full")
        };
        let windows = [filled, at("a"), at("b")];
        assert_eq!(
            front_to_back(&UseOrder::default(), &windows, None),
            ["full", "b", "a"]
        );
        let mut used = UseOrder::default();
        used.touch("a");
        assert_eq!(front_to_back(&used, &windows, None), ["a", "full", "b"]);
    }

    #[test]
    fn puts_the_window_in_use_above_a_floating_and_a_filled_one() {
        let normal = Placement {
            pinned: true,
            ..at("n")
        };
        let floating = Placement {
            floating: Some(true),
            ..at("f")
        };
        let filled = Placement {
            floating: Some(true),
            fill: Some(Fill::Full),
            ..at("full")
        };
        assert!(z_of(&normal, 0, Some("n")) > z_of(&floating, 1, Some("n")));
        assert!(z_of(&normal, 0, Some("n")) > z_of(&filled, 2, Some("n")));
        assert!(z_of(&filled, 0, Some("full")) > z_of(&floating, 1, Some("full")));
    }

    #[test]
    fn keeps_a_window_floating_by_choice_above_the_others_and_a_fill_among_them() {
        let floating = Placement {
            floating: Some(true),
            ..at("f")
        };
        let filled = Placement {
            floating: Some(true),
            fill: Some(Fill::Left),
            ..at("left")
        };
        let windows = [floating, filled, at("a"), at("b")];
        let mut used = UseOrder::default();
        for id in ["f", "a", "left", "b"] {
            used.touch(id);
        }
        assert_eq!(
            front_to_back(&used, &windows, None),
            ["f", "b", "left", "a"]
        );
    }
}
