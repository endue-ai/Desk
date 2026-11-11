//! The order the windows stack in (issues #159 and #163): the order of use. The window in use is on
//! top of every other, a filled or floating one too; the one used before it is right behind it,
//! whether it was moved, filled or is new; a window floating by choice stays above the normal ones
//! not in use. Read where the person meets it: `desk.windows.list`'s order, the levels the page
//! stacks its windows by (`View::front`) and the order the compositor draws them in (`host_plan`).

mod common;

use common::*;
use desk_wm::{ArrangeKind, Arranger, Desk, GAP, Rect, Size, TopChrome, Unseen, View};

const W: f64 = 1280.0;
const H: f64 = 800.0;

/// A desk of four plugin windows in their slots, in desk order: `p.a` at the back.
fn desk() -> Desk {
    let mut d = sample(EPOCH);
    adopt(&mut d, &["p.a", "p.b", "p.c", "p.d"]);
    d
}

/// The windows of the desktop in front, front to back, as `desk.windows.list` answers; the page's
/// levels and the compositor's drawing order say the same.
fn pile(d: &Desk) -> Vec<String> {
    let here = d.here();
    let listed: Vec<String> = (d.snapshot(W, H).windows.into_iter())
        .filter(|w| w.desktop.as_deref() == Some(here.as_str()))
        .map(|w| w.id)
        .collect();
    let mut drawn: Vec<String> = (d.host_plan(W, H, TopChrome::default(), &Unseen).windows)
        .into_iter()
        .map(|w| w.id)
        .collect();
    drawn.reverse();
    let mut front = View::of(d, &Arranger::default(), Size { w: W, h: H }).front;
    front.sort_by_key(|s| std::cmp::Reverse(s.z));
    let levels: Vec<String> = front.into_iter().map(|s| s.id).collect();
    assert_eq!(
        drawn, listed,
        "the compositor draws the windows as they are listed"
    );
    assert_eq!(
        levels, listed,
        "the page stacks the windows as they are listed"
    );
    listed
}

/// The first `n` of the pile.
fn top(d: &Desk, n: usize) -> Vec<String> {
    pile(d).into_iter().take(n).collect()
}

mod the_order_of_use {
    use super::*;

    #[test]
    fn puts_the_window_used_a_moment_ago_right_behind_the_one_in_use() {
        let mut d = desk();
        d.focus_pane("p.a", None);
        d.focus_pane("p.c", None);
        assert_eq!(top(&d, 2), ["p.c", "p.a"]);
        d.focus_pane("p.b", None);
        assert_eq!(pile(&d), ["p.b", "p.c", "p.a", "p.d"]);
    }

    #[test]
    fn keeps_a_window_that_was_moved_or_filled_and_given_back_where_its_use_puts_it() {
        let mut d = desk();
        d.focus_pane("p.b", None);
        d.place("p.b", Rect::new(600.0, 300.0, 400.0, 300.0));
        d.focus_pane("p.d", None);
        assert_eq!(top(&d, 2), ["p.d", "p.b"]);
        d.focus_pane("p.c", None);
        d.toggle_maximize("p.c");
        d.toggle_maximize("p.c");
        d.focus_pane("p.a", None);
        assert_eq!(pile(&d), ["p.a", "p.c", "p.d", "p.b"]);
    }

    #[test]
    fn stacks_new_windows_in_the_order_they_opened_the_last_on_top() {
        let mut d = desk();
        let opened: Vec<String> = (0..10).map(|_| d.new_window()).collect();
        let mut newest_first = opened.clone();
        newest_first.reverse();
        assert_eq!(top(&d, 10), newest_first);
        assert_eq!(pile(&d).len(), 14);
    }

    #[test]
    fn leaves_the_windows_never_in_use_under_the_others_in_desk_order() {
        let mut d = desk();
        d.focus_pane("p.b", None);
        assert_eq!(pile(&d), ["p.b", "p.d", "p.c", "p.a"]);
    }

    #[test]
    fn is_kept_in_the_desks_json() {
        let mut d = desk();
        d.focus_pane("p.a", None);
        d.focus_pane("p.c", None);
        let back: Desk = serde_json::from_value(serde_json::to_value(&d).unwrap()).unwrap();
        assert_eq!(pile(&back), pile(&d));
    }
}

mod the_window_in_use {
    use super::*;

    #[test]
    fn opens_in_front_of_a_maximized_window_and_the_fill_stays_behind_it() {
        let mut d = desk();
        d.focus_pane("p.a", None);
        d.toggle_maximize("p.a");
        assert_eq!(top(&d, 1), ["p.a"]);
        let fresh = d.new_window();
        assert_eq!(top(&d, 2), [fresh.as_str(), "p.a"]);
    }

    #[test]
    fn reached_by_the_focus_cycle_comes_in_front_of_a_snapped_window() {
        let mut d = desk();
        d.focus_pane("p.c", None);
        d.snap_to("p.c", desk_wm::Fill::Left);
        let fresh = d.new_window();
        let reached = d.focus_next(1).expect("a stop");
        let window = d.focused.clone().expect("a window in use");
        assert_ne!(window, fresh, "the cycle left the new window ({reached})");
        // The new window, used a moment ago, stays in front of the snapped one too.
        assert_eq!(top(&d, 3), [window.as_str(), fresh.as_str(), "p.c"]);
    }

    #[test]
    fn is_above_a_window_floating_by_choice_which_stays_above_the_normal_ones() {
        let mut d = desk();
        d.toggle_floating("p.b", W, H);
        d.focus_pane("p.b", None);
        d.focus_pane("p.c", None);
        assert_eq!(top(&d, 2), ["p.c", "p.b"]);
        d.focus_pane("p.d", None);
        assert_eq!(top(&d, 3), ["p.d", "p.b", "p.c"]);
    }
}

mod a_cascade {
    use super::*;

    #[test]
    fn lays_the_windows_out_in_the_order_they_stack_and_keeps_it() {
        let mut d = desk();
        for id in ["p.c", "p.a", "p.d", "p.b"] {
            d.focus_pane(id, None);
        }
        let before = pile(&d);
        Arranger::default()
            .arrange(&mut d, ArrangeKind::Cascade, W, H, GAP, EPOCH)
            .expect("cascaded");
        assert_eq!(pile(&d), before);
        // Back to front, each step lower and further right: every title bar shows.
        let ys: Vec<f64> = (before.iter().rev())
            .map(|id| rect_of(&d, id).expect("drawn").y)
            .collect();
        assert!(ys.windows(2).all(|y| y[0] < y[1]), "{ys:?}");
    }
}
