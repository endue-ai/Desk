//! Ported from `packages/runtime/src/surface/tree.test.ts` (the pane tree) and
//! `shell/panes.test.ts` (a window's panes as the runtime's host views), case by case.
//!
//! `surface/PaneView.ts` draws the tree and moves its dividers by drag and by arrow keys; it had no
//! unit test, so its rules gain cases here, as do `shell/windows.ts`'s split and close of the
//! focused pane (`splitPane`, `closePane`, `showInPane`, `resizeSplit`), which the shell e2e
//! checked through the DOM.

mod common;

use common::*;
use desk_wm::panes::{self, LAUNCHER, MIN_RATIO, STEP};
use desk_wm::{Desk, PANE_MIN, PaneNode, Placement, Rect, SplitDir, window_min};

fn one() -> PaneNode {
    PaneNode::view("p1", "calendar")
}

fn leaf_ids(node: &PaneNode) -> Vec<&str> {
    node.leaves().into_iter().map(|(id, _)| id).collect()
}

fn leaf_views(node: &PaneNode) -> Vec<&str> {
    node.leaves().into_iter().map(|(_, view)| view).collect()
}

fn ratio(node: &PaneNode) -> f64 {
    match node {
        PaneNode::Split { ratio, .. } => *ratio,
        PaneNode::View { .. } => panic!("not a split"),
    }
}

mod the_pane_tree {
    use super::*;

    #[test]
    fn a_surface_saved_without_panes_is_one_pane_showing_the_view_named_by_its_id() {
        let p = Placement::new("notes", "endue.notes", Rect::default());
        assert_eq!(p.panes(), PaneNode::view("p1", "notes"));
    }

    #[test]
    fn splitting_keeps_the_pane_first_and_adds_a_launcher_second() {
        let (node, added) = panes::split(&one(), "p1", SplitDir::Row, LAUNCHER);
        assert_eq!(added, "p2");
        match &node {
            PaneNode::Split { dir, ratio, .. } => {
                assert_eq!(*dir, SplitDir::Row);
                assert_eq!(*ratio, 0.5);
            }
            PaneNode::View { .. } => panic!("not split"),
        }
        assert_eq!(node.leaves(), [("p1", "calendar"), ("p2", LAUNCHER)]);
    }

    #[test]
    fn splits_nest_and_ids_never_repeat() {
        let a = panes::split(&one(), "p1", SplitDir::Row, LAUNCHER).0;
        let b = panes::split(&a, "p1", SplitDir::Column, LAUNCHER).0;
        assert_eq!(leaf_ids(&b), ["p1", "p3", "p2"]);
        assert_eq!(panes::next_pane_id(&b), "p4");
    }

    #[test]
    fn closing_a_pane_gives_its_sibling_the_whole_split_the_last_pane_closes_to_null() {
        let a = panes::split(&one(), "p1", SplitDir::Row, LAUNCHER).0;
        assert_eq!(panes::close(&a, "p2"), Some(one()));
        assert_eq!(panes::close(&one(), "p1"), None);
        let b = panes::split(&a, "p2", SplitDir::Column, LAUNCHER).0;
        assert_eq!(leaf_ids(&panes::close(&b, "p3").unwrap()), ["p1", "p2"]);
    }

    #[test]
    fn a_pane_can_show_another_view() {
        let a = panes::split(&one(), "p1", SplitDir::Row, LAUNCHER).0;
        assert_eq!(
            leaf_views(&panes::set_view(&a, "p2", "notes")),
            ["calendar", "notes"]
        );
    }

    #[test]
    fn ratios_stay_between_15_and_85() {
        let a = panes::split(&one(), "p1", SplitDir::Row, LAUNCHER).0;
        assert_eq!(ratio(&panes::set_ratio(&a, "s2", 0.99)), 0.85);
        assert_eq!(ratio(&panes::set_ratio(&a, "s2", 0.0)), 0.15);
        assert_eq!(ratio(&panes::set_ratio(&a, "s2", 0.3333)), 0.333);
    }
}

mod pane_views {
    use super::*;

    #[test]
    fn a_pane_showing_a_plugins_surface_is_not_a_host_view_the_runtimes_surface_counts_once() {
        let mut desk = sample(0);
        let mut counter = at("test.counter", "test.counter", 600.0, 120.0, 400.0, 300.0);
        counter.panes = Some(PaneNode::view("p1", "plugin:test.counter"));
        let notes = at("notes", "endue.notes", 120.0, 120.0, 400.0, 300.0);
        desk.set(|d| {
            d.session.insert("1".into(), layout(vec![notes, counter]));
        });
        assert_eq!(desk.pane_views(), ["notes/p1"]);
    }
}

mod dividers {
    use super::*;

    #[test]
    fn an_arrow_along_the_split_moves_its_divider_by_a_step_other_keys_pass() {
        assert_eq!(STEP, 0.05);
        assert_eq!(
            panes::key_ratio(0.5, SplitDir::Row, "ArrowRight"),
            Some(0.55)
        );
        assert_eq!(
            panes::key_ratio(0.5, SplitDir::Row, "ArrowLeft"),
            Some(0.45)
        );
        assert_eq!(
            panes::key_ratio(0.5, SplitDir::Column, "ArrowDown"),
            Some(0.55)
        );
        assert_eq!(panes::key_ratio(0.5, SplitDir::Row, "ArrowUp"), None);
        assert_eq!(panes::key_ratio(0.5, SplitDir::Column, "ArrowLeft"), None);
    }

    #[test]
    fn a_drag_moves_it_by_the_pointers_share_of_the_split_within_15_to_85() {
        // A 600 px wide row: 120 px to the right is a fifth more for the first pane.
        let r = panes::drag_ratio(0.5, SplitDir::Row, 120.0, 40.0, 600.0);
        assert!((r - 0.7).abs() < 1e-9, "{r}");
        assert_eq!(
            panes::drag_ratio(0.5, SplitDir::Column, 0.0, 900.0, 600.0),
            0.85
        );
        assert_eq!(
            panes::drag_ratio(0.5, SplitDir::Row, -900.0, 0.0, 600.0),
            MIN_RATIO
        );
        // A split with no size yet counts as one pixel.
        assert_eq!(panes::drag_ratio(0.5, SplitDir::Row, 0.0, 0.0, 0.0), 0.5);
    }
}

mod splitting_and_closing {
    use super::*;

    fn notes_desk() -> Desk {
        let mut desk = sample(EPOCH);
        desk.open_surface("notes", None);
        desk
    }

    fn panes_of(desk: &Desk, id: &str) -> PaneNode {
        desk.windows()
            .into_iter()
            .find(|p| p.id == id)
            .expect("the window")
            .panes()
    }

    #[test]
    fn splitting_the_focused_pane_opens_a_launcher_beside_it_and_focuses_it() {
        let mut desk = notes_desk();
        desk.split(SplitDir::Row);
        let tree = panes_of(&desk, "notes");
        assert_eq!(tree.leaves(), [("p1", "notes"), ("p2", LAUNCHER)]);
        assert_eq!(desk.focused.as_deref(), Some("notes"));
        assert_eq!(desk.pane.as_deref(), Some("p2"));
        // Down splits the pane in use, now the launcher.
        desk.split(SplitDir::Column);
        assert_eq!(leaf_ids(&panes_of(&desk, "notes")), ["p1", "p2", "p3"]);
        assert_eq!(desk.pane.as_deref(), Some("p3"));
    }

    #[test]
    fn closing_a_pane_focuses_the_first_one_left_and_the_last_pane_closes_the_window() {
        let mut desk = notes_desk();
        desk.split(SplitDir::Row);
        assert!(desk.close_pane(None, None).is_empty());
        assert_eq!(panes_of(&desk, "notes"), PaneNode::view("p1", "notes"));
        assert_eq!(desk.pane.as_deref(), Some("p1"));
        assert!(desk.close_pane(None, None).is_empty());
        assert!(desk.layout().surfaces.is_empty());
        assert_eq!(desk.focused, None);
        assert_eq!(desk.pane, None);
    }

    #[test]
    fn closing_the_last_pane_of_a_plugin_window_unmounts_its_plugin() {
        let mut desk = sample(EPOCH);
        adopt(&mut desk, &["p.a"]);
        assert_eq!(desk.close_pane(Some("p.a"), Some("p1")), ["p.a"]);
    }

    #[test]
    fn a_pane_shows_another_view_and_takes_the_focus() {
        let mut desk = notes_desk();
        desk.split(SplitDir::Row);
        desk.focus_pane("notes", Some("p1"));
        desk.show_in_pane("notes", "p2", "calendar");
        assert_eq!(leaf_views(&panes_of(&desk, "notes")), ["notes", "calendar"]);
        assert_eq!(desk.pane.as_deref(), Some("p2"));
    }

    #[test]
    fn a_dividers_ratio_is_kept_between_15_and_85_and_to_three_decimals() {
        let mut desk = notes_desk();
        let wide = Rect::new(100.0, 100.0, 1000.0, 400.0);
        desk.update("notes", |p| p.set_rect(wide));
        desk.split(SplitDir::Row);
        desk.resize_split("notes", "s2", 0.123_45);
        assert_eq!(ratio(&panes_of(&desk, "notes")), 0.15);
        desk.resize_split("notes", "s2", 0.666_66);
        assert_eq!(ratio(&panes_of(&desk, "notes")), 0.667);
    }

    #[test]
    fn a_divider_leaves_each_pane_room_for_its_header_and_a_split_grows_a_small_window() {
        let mut desk = notes_desk();
        let small = Rect::new(100.0, 100.0, 300.0, 300.0);
        desk.update("notes", |p| p.set_rect(small));
        desk.split(SplitDir::Row);
        // 15 % of a 298 px body would leave the first pane 45 px.
        desk.resize_split("notes", "s2", 0.15);
        let body = small.w - 2.0;
        assert!(ratio(&panes_of(&desk, "notes")) * body >= PANE_MIN.w - 1e-9);
        desk.resize_split("notes", "s2", 0.85);
        let rest = (1.0 - ratio(&panes_of(&desk, "notes"))) * body - 1.0;
        assert!(rest >= PANE_MIN.w - 1e-9, "{rest}");
        // A third pane does not fit 300 px: the window grows to its new minimum.
        desk.split(SplitDir::Row);
        let p = desk.window("notes").unwrap();
        assert_eq!(p.w, window_min(&p.panes()).w);
        assert_eq!(p.w, 3.0 * PANE_MIN.w + 2.0 + 2.0);
    }
}
