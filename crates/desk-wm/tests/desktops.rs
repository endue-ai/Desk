//! Ported from `packages/runtime/src/desktops/model.test.ts` (the named, open-ended list of
//! ADR 0117 and its operations in `ops.ts`) and `move.test.ts` (a window moved across), case by
//! case. The TS cases build a `DeskState` and apply each operation's patch; here the operations
//! change the `Desk`. `migrate.test.ts` is `tests/migrate.rs`. Also `desktops/actions.ts`'s
//! `switchTo` and `step`, which had no unit test: the window in use per desktop.

mod common;

use std::collections::BTreeMap;

use common::*;
use desk_wm::desktops::{MAX_DESKTOPS, added, default_desktops, moved, next_id, renamed};
use desk_wm::{Desk, Desktop, DesktopLayout, InUse, Offset, OnRemove, PaneNode, Placement};

fn win(id: &str, x: f64) -> Placement {
    at(id, "endue.notes", x, 120.0, 400.0, 300.0)
}

fn names(d: &Desk) -> Vec<String> {
    d.desktops().iter().map(|d| d.name.clone()).collect()
}

fn list_ids(d: &Desk) -> Vec<String> {
    d.desktops().iter().map(|d| d.id.clone()).collect()
}

fn desktop(id: &str, name: &str) -> Desktop {
    Desktop {
        id: id.into(),
        name: name.into(),
    }
}

/// A desk with these desktops moved in the session.
fn with_session(layouts: &[(&str, DesktopLayout)]) -> Desk {
    let mut desk = Desk::default();
    desk.set(|d| {
        for (id, l) in layouts {
            d.session.insert((*id).into(), l.clone());
        }
    });
    desk
}

mod desktops_are_a_named_open_ended_list {
    use super::*;

    #[test]
    fn a_fresh_desk_has_four_desktops_named_1_to_4_and_nothing_to_save() {
        let s = Desk::default();
        assert_eq!(s.desktops(), default_desktops());
        assert_eq!(names(&s), ["1", "2", "3", "4"]);
        assert!(!s.dirty());
    }

    #[test]
    fn adds_a_desktop_at_the_end_with_a_fresh_id_and_the_first_free_number_as_its_name() {
        let mut s = Desk::default();
        assert_eq!(s.add_desktop(None).as_deref(), Some("5"));
        assert_eq!(names(&s), ["1", "2", "3", "4", "5"]);
        s.add_desktop(Some("  Research   notes "));
        assert_eq!(s.desktops()[5], desktop("6", "Research notes"));
        // The added desktops are a change to the profile, until it is saved or reverted.
        assert!(s.dirty());
    }

    #[test]
    fn renames_and_an_empty_name_keeps_the_old_one() {
        let mut s = Desk::default();
        s.rename_desktop(2, "Mail");
        assert_eq!(names(&s), ["1", "Mail", "3", "4"]);
        s.rename_desktop("2", "   ");
        assert_eq!(names(&s), ["1", "Mail", "3", "4"]);
        let long = renamed(&default_desktops(), "1", &"x".repeat(80));
        assert_eq!(long[0].name.chars().count(), 40);
    }

    #[test]
    fn reorders_by_id_the_id_stays_with_the_desktop_the_index_is_its_new_position() {
        let mut s = with_session(&[("3", layout(vec![win("notes", 100.0)]))]);
        s.reorder_desktop("3", 1);
        assert_eq!(list_ids(&s), ["3", "1", "2", "4"]);
        assert_eq!(ids(&s.layout_of(1).surfaces), ["notes"]);
        let ids_moved: Vec<String> = moved(&default_desktops(), "1", 99)
            .into_iter()
            .map(|d| d.id)
            .collect();
        assert_eq!(ids_moved, ["2", "3", "4", "1"]);
        // Back in the profile's order: nothing left to save.
        s.reorder_desktop("3", 3);
        assert_eq!(s.desktops, None);
    }

    #[test]
    fn removing_a_desktop_moves_its_windows_to_the_one_before_it_at_the_same_place_on_screen() {
        let mut s = with_session(&[
            ("2", layout(vec![win("mail", 40.0)])),
            ("3", layout(vec![win("notes", 300.0)])),
        ]);
        s.set(|d| {
            d.desktop = "3".into();
            d.pan.insert("2".into(), Offset::new(0.0, 0.0));
            d.pan.insert("3".into(), Offset::new(-200.0, 0.0));
        });
        let removal = s.remove_desktop("3", OnRemove::Move).expect("removed");
        assert_eq!(removal.into, "2");
        assert_eq!(list_ids(&s), ["1", "2", "4"]);
        assert_eq!(s.desktop, "2");
        // 300 on a canvas panned by -200 sat at 100 on screen; desktop 2 is not panned.
        let placed: Vec<(String, f64)> = s
            .layout_of("2")
            .surfaces
            .iter()
            .map(|p| (p.id.clone(), p.x))
            .collect();
        assert_eq!(placed, [("mail".into(), 40.0), ("notes".into(), 100.0)]);
        assert!(!s.session.contains_key("3"));
        assert!(!s.pan.contains_key("3"));
    }

    #[test]
    fn removing_the_first_desktop_sends_its_windows_to_the_next_closing_them_drops_them() {
        let s = with_session(&[("1", layout(vec![win("notes", 100.0)]))]);
        let into = s
            .clone()
            .remove_desktop("1", OnRemove::Move)
            .map(|r| r.into);
        assert_eq!(into.as_deref(), Some("2"));
        let mut closing = s.clone();
        let closed = closing
            .remove_desktop("1", OnRemove::Close)
            .expect("removed");
        assert_eq!(ids(&closed.closed), ["notes"]);
        assert!(closing.layout_of("2").surfaces.is_empty());
    }

    #[test]
    fn keeps_the_last_desktop() {
        let mut s = Desk::default();
        for id in ["1", "2", "3"] {
            s.remove_desktop(id, OnRemove::Close);
        }
        assert_eq!(list_ids(&s), ["4"]);
        assert!(s.remove_desktop("4", OnRemove::Close).is_none());
    }

    #[test]
    fn stops_at_32_desktops() {
        let mut s = Desk::default();
        while s.add_desktop(None).is_some() {}
        assert_eq!(s.desktops().len(), MAX_DESKTOPS);
        assert!(added(s.desktops(), Vec::<String>::new(), None).is_none());
    }

    #[test]
    fn never_gives_a_new_desktop_the_id_of_one_a_layout_still_names() {
        assert_eq!(next_id(["1", "2", "3", "4", "7"]), "8");
        let mut s = with_session(&[("4", layout(vec![win("notes", 100.0)]))]);
        s.remove_desktop("4", OnRemove::Close);
        s.set(|d| d.pan = BTreeMap::from([("9".into(), Offset::new(1.0, 1.0))]));
        assert_eq!(s.add_desktop(None).as_deref(), Some("10"));
    }

    #[test]
    fn every_desktop_keeps_its_own_layout_and_pan() {
        let mut s = with_session(&[
            ("1", layout(vec![win("a", 100.0)])),
            ("2", layout(vec![win("b", 100.0)])),
        ]);
        s.set(|d| {
            d.pan.insert("1".into(), Offset::new(-50.0, 0.0));
            d.pan.insert("2".into(), Offset::new(0.0, -80.0));
        });
        let six = s.add_desktop(Some("Six")).expect("added");
        s.set(|d| {
            d.session.insert(six.clone(), layout(vec![win("c", 100.0)]));
        });
        s.reorder_desktop(six.as_str(), 1);
        let each: Vec<(String, Vec<String>)> = s
            .desktops()
            .iter()
            .map(|d| (d.name.clone(), ids(&s.layout_of(d.id.as_str()).surfaces)))
            .collect();
        let want: Vec<(String, Vec<String>)> = [
            ("Six", vec!["c"]),
            ("1", vec!["a"]),
            ("2", vec!["b"]),
            ("3", vec![]),
            ("4", vec![]),
        ]
        .into_iter()
        .map(|(n, w)| (n.to_string(), w.into_iter().map(String::from).collect()))
        .collect();
        assert_eq!(each, want);
        assert_eq!(s.pan["1"], Offset::new(-50.0, 0.0));
        assert_eq!(s.pan["2"], Offset::new(0.0, -80.0));
    }
}

mod moving_a_window_to_another_desktop {
    use super::*;

    fn notes() -> Placement {
        let mut p = at("notes", "endue.notes", 300.0, 200.0, 420.0, 360.0);
        p.pinned = true;
        p.panes = Some(PaneNode::view("p1", "notes"));
        p
    }

    /// Notes in use on desktop 1, panned; desktop 3 panned differently.
    fn desk() -> Desk {
        let mut s = with_session(&[("1", layout(vec![notes()]))]);
        s.set(|d| {
            d.pan.insert("1".into(), Offset::new(-100.0, 0.0));
            d.pan.insert("3".into(), Offset::new(50.0, 40.0));
            d.focused = Some("notes".into());
            d.pane = Some("p1".into());
        });
        s
    }

    fn on(s: &Desk, desktop: &str) -> Vec<String> {
        ids(&s.windows_of(desktop))
    }

    #[test]
    fn keeps_its_size_panes_and_place_on_screen() {
        let mut s = desk();
        s.move_to_desktop("notes", "3", None);
        assert!(on(&s, "1").is_empty());
        // On screen it sat at 300 - 100 = 200, 200; desktop 3 is panned by 50, 40.
        let mut want = notes();
        want.x = 150.0;
        want.y = 160.0;
        assert_eq!(s.layout_of("3").surfaces, [want]);
    }

    #[test]
    fn is_the_window_in_use_on_the_desktop_it_went_to_and_the_desk_stays_where_it_is() {
        let mut s = desk();
        s.move_to_desktop("notes", "3", None);
        assert_eq!(s.desktop, "1");
        assert_eq!(s.focused, None);
        assert_eq!(
            s.focus_by.get("3"),
            Some(&InUse {
                window: "notes".into(),
                pane: Some("p1".into()),
            })
        );
    }

    #[test]
    fn takes_a_desktop_by_position_too_and_does_nothing_for_the_same_desktop_or_none() {
        assert_eq!(
            desk().move_to_desktop("notes", 3, None).map(|m| m.to),
            Some("3".into())
        );
        assert!(desk().move_to_desktop("notes", "1", None).is_none());
        assert!(desk().move_to_desktop("notes", 9, None).is_none());
        assert!(desk().move_to_desktop("missing", "2", None).is_none());
    }

    #[test]
    fn lands_where_it_was_before_a_drag_that_ended_on_a_desktop() {
        let mut dragged = desk();
        let mut far = notes();
        far.x = 1200.0;
        far.y = 10.0;
        dragged.set(|d| {
            d.session.insert("1".into(), layout(vec![far]));
        });
        dragged.move_to_desktop("notes", "2", Some(&notes()));
        let there = &dragged.layout_of("2").surfaces[0];
        assert_eq!(
            (there.x, there.y, there.w, there.h),
            (200.0, 200.0, 420.0, 360.0)
        );
    }

    #[test]
    fn is_undone_the_window_comes_back_where_it_was_in_use_again() {
        let mut s = desk();
        let moved = s.move_to_desktop("notes", "3", None).expect("moved");
        assert!(s.move_back(&moved));
        assert_eq!(s.layout_of("1").surfaces, [notes()]);
        assert!(s.layout_of("3").surfaces.is_empty());
        assert_eq!(s.focused.as_deref(), Some("notes"));
        assert!(!s.focus_by.contains_key("3"));
        // Once it is gone from where it went, there is nothing to take back.
        assert!(!s.move_back(&moved));
    }

    #[test]
    fn a_plugin_window_in_its_slot_lives_on_the_desktop_it_went_to_and_only_there() {
        let mut s = Desk::default();
        adopt(&mut s, &["p.term"]);
        assert_eq!(on(&s, "1"), ["p.term"]);
        assert_eq!(on(&s, "2"), ["p.term"]);
        let moved = s.move_to_desktop("p.term", "2", None).expect("moved");
        assert!(on(&s, "1").is_empty());
        assert_eq!(on(&s, "2"), ["p.term"]);
        assert!(on(&s, "4").is_empty());
        assert_eq!(s.holder_of("p.term").as_deref(), Some("2"));
        // Undone, it is back in its slot on every desktop.
        assert!(s.move_back(&moved));
        assert_eq!(on(&s, "1"), ["p.term"]);
        assert_eq!(on(&s, "4"), ["p.term"]);
    }
}

mod switching_desktops {
    use super::*;

    #[test]
    fn a_desktop_brought_back_gives_the_focus_to_the_window_it_had_in_use() {
        let mut s = with_session(&[
            ("1", layout(vec![win("a", 100.0)])),
            ("2", layout(vec![win("b", 100.0)])),
        ]);
        s.focus_pane("a", None);
        s.switch_to("2");
        assert_eq!(s.desktop, "2");
        assert_eq!(s.focused, None);
        let kept = InUse {
            window: "a".into(),
            pane: Some("p1".into()),
        };
        assert_eq!(s.focus_by.get("1"), Some(&kept));
        s.focus_pane("b", None);
        s.switch_to(1);
        assert_eq!(s.focused.as_deref(), Some("a"));
        assert_eq!(s.pane.as_deref(), Some("p1"));
        assert_eq!(s.focus_by["2"].window, "b");
        // The one it came back to keeps its entry, for the next time it is left.
        assert_eq!(s.focus_by.get("1"), Some(&kept));
    }

    #[test]
    fn next_and_previous_go_round_the_list_and_a_missing_desktop_changes_nothing() {
        let mut s = Desk::default();
        s.step_desktop(-1);
        assert_eq!(s.desktop, "4");
        s.step_desktop(1);
        assert_eq!(s.desktop, "1");
        s.switch_to(9);
        assert_eq!(s.desktop, "1");
    }
}
