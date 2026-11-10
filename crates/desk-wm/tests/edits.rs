//! The runtime's edits on the window manager (#83): what each one changes and answers, and what the
//! runtime reads back (`View`). Ported from the runtime's `shell/link.test.ts` (the session's
//! restore and its slots), `desktops/actions.ts`' undo and `arrange/commands.test.ts`' answers,
//! whose state the runtime no longer keeps; the operations themselves have their own tests
//! (`desk.rs`, `desktops.rs`, `drawer.rs`, `arrange.rs`).

mod common;

use common::*;
use desk_wm::desktops::Desktop;
use desk_wm::edits::{Edit, Kept, Windows, apply};
use desk_wm::{Adopted, Desk, DrawerItem, DrawerKind, Saved, Size, View};
use serde_json::{Value, json};

const SCREEN: Size = Size {
    w: 1440.0,
    h: 900.0,
};

/// Apply `edits` in order; what each answered.
fn run(desk: &mut Desk, kept: &mut Kept, edits: &[Edit]) -> Vec<Value> {
    edits.iter().map(|e| apply(desk, kept, e, SCREEN)).collect()
}

fn edit(value: Value) -> Edit {
    serde_json::from_value(value).expect("an edit")
}

fn named(list: &[(&str, &str)]) -> Vec<Desktop> {
    (list.iter())
        .map(|(id, name)| Desktop {
            id: (*id).into(),
            name: (*name).into(),
        })
        .collect()
}

mod the_records {
    use super::*;

    #[test]
    fn edits_read_as_the_runtime_writes_them() {
        let e = edit(json!({ "op": "move-to-desktop", "window": "w", "desktop": 2 }));
        assert!(matches!(e, Edit::MoveToDesktop { .. }));
        let e = edit(json!({ "op": "remove-desktop", "desktop": "3", "windows": "close" }));
        assert!(matches!(
            e,
            Edit::RemoveDesktop {
                windows: Windows::Close,
                ..
            }
        ));
        assert!(matches!(
            edit(json!({ "op": "arrange", "kind": "tile", "now": 5 })),
            Edit::Arrange { .. }
        ));
    }

    #[test]
    fn the_session_layer_moves_layouts_and_a_list_of_its_own_and_the_desk_stays_where_it_can() {
        let mut desk = Desk::default();
        let mut kept = Kept::default();
        run(
            &mut desk,
            &mut kept,
            &[Edit::SwitchTo {
                desktop: "3".into(),
            }],
        );
        let value = json!({ "desktops": [
            { "id": "1", "name": "Write", "layout": { "surfaces": [at("n", "endue.notes", 0.0, 0.0, 10.0, 10.0)] } },
            { "id": "2", "name": "Read" }
        ] });
        run(&mut desk, &mut kept, &[Edit::Moved { value }]);
        assert_eq!(desk.desktops(), named(&[("1", "Write"), ("2", "Read")]));
        assert_eq!(desk.here(), "1", "desktop 3 is gone: the first");
        assert_eq!(desk.layout_of("1").surfaces[0].id, "n");
        // The profile's own list again: no list of the session's.
        let own = json!({ "desktops": [
            { "id": "1", "name": "1" }, { "id": "2", "name": "2" },
            { "id": "3", "name": "3" }, { "id": "4", "name": "4" }
        ] });
        run(&mut desk, &mut kept, &[Edit::Moved { value: own }]);
        assert_eq!(desk.desktops, None);
        run(&mut desk, &mut kept, &[Edit::Revert]);
        assert!(desk.session.is_empty() && !desk.dirty());
    }

    #[test]
    fn a_profile_laid_out_again_keeps_the_session_and_its_desktop() {
        let mut desk = Desk::default();
        let mut kept = Kept::default();
        run(
            &mut desk,
            &mut kept,
            &[
                Edit::SwitchTo {
                    desktop: "4".into(),
                },
                Edit::NewWindow,
            ],
        );
        let saved = Saved {
            list: named(&[("1", "A"), ("2", "B")]),
            ..Saved::default()
        };
        run(&mut desk, &mut kept, &[Edit::Saved { saved }]);
        assert_eq!(desk.here(), "2", "the same position, or the last");
        assert_eq!(desk.session["4"].surfaces.len(), 1, "the session stays");
    }

    #[test]
    fn a_restored_session_puts_each_window_back_on_its_slot_and_its_desktop_and_pans() {
        let mut desk = Desk::default();
        let mut kept = Kept::default();
        for id in ["p.a", "p.b", "p.c"] {
            run(
                &mut desk,
                &mut kept,
                &[Edit::Adopt {
                    id: id.into(),
                    title: id.into(),
                }],
            );
        }
        let old = DrawerItem {
            id: "recent-x".into(),
            kind: DrawerKind::Recent,
            name: "X".into(),
            at: 120_000,
            placement: None,
        };
        let restore = Edit::Restore {
            desktop: json!(2),
            pan: json!({ "2": { "x": -40, "y": 10 }, "9": { "x": 1, "y": 1 }, "3": { "x": null, "y": 0 } }),
            drawer: json!([old, { "id": "bad", "kind": "nothing" }, { "id": "f", "kind": "file", "name": "f.txt", "at": 1_793_178_000_000.4 }]),
            slots: json!({ "p.c": { "slot": 0, "at": { "x": -40, "y": 10 } }, "p.a": { "slot": 2 } }),
            now: EPOCH,
        };
        run(&mut desk, &mut kept, &[restore]);
        assert_eq!(desk.here(), "2", "a position before ADR 0117");
        assert_eq!(desk.pan.len(), 1, "only a finite pan of a desktop it has");
        assert_eq!(desk.drawer[0].at, EPOCH, "dated by a clock: dated now");
        assert_eq!(desk.drawer.len(), 2, "an item it cannot read is left out");
        assert_eq!(
            desk.drawer[1].at, EPOCH,
            "a wall-clock time in whole milliseconds"
        );
        let slot = |id: &str| {
            desk.adopted
                .iter()
                .find(|a| a.id == id)
                .and_then(|a| a.slot)
        };
        assert_eq!((slot("p.c"), slot("p.a")), (Some(0), Some(2)));
        assert_eq!(slot("p.b"), Some(1), "the one not saved keeps a free slot");
        let c: &Adopted = desk.adopted.iter().find(|a| a.id == "p.c").unwrap();
        assert_eq!(c.at.map(|a| a.x), Some(-40.0));
    }
}

mod the_desktops_undo {
    use super::*;

    #[test]
    fn a_window_moved_to_another_desktop_comes_back_and_a_second_undo_has_nothing() {
        let mut desk = Desk::default();
        let mut kept = Kept::default();
        let id = run(&mut desk, &mut kept, &[Edit::NewWindow])[0].clone();
        let id = id.as_str().unwrap().to_owned();
        let moved = Edit::MoveToDesktop {
            window: id.clone(),
            desktop: "3".into(),
            before: None,
        };
        assert_eq!(run(&mut desk, &mut kept, &[moved]), [json!(true)]);
        assert!(desk.layout_of("1").surfaces.is_empty());
        assert_eq!(
            run(
                &mut desk,
                &mut kept,
                &[Edit::UndoDesktop, Edit::UndoDesktop]
            ),
            [json!(true), json!(false)]
        );
        assert_eq!(desk.layout_of("1").surfaces[0].id, id);
    }

    #[test]
    fn a_removal_that_moved_its_windows_comes_back_while_nothing_changed_since() {
        let mut desk = Desk::default();
        let mut kept = Kept::default();
        run(
            &mut desk,
            &mut kept,
            &[
                Edit::SwitchTo {
                    desktop: "2".into(),
                },
                Edit::NewWindow,
            ],
        );
        let removed = Edit::RemoveDesktop {
            desktop: "2".into(),
            windows: Windows::Move,
        };
        let answer = run(&mut desk, &mut kept, &[removed]);
        assert_eq!(answer, [json!({ "name": "2", "closed": [] })]);
        assert_eq!((desk.desktops().len(), desk.here().as_str()), (3, "1"));
        assert_eq!(
            run(&mut desk, &mut kept, &[Edit::UndoDesktop]),
            [json!(true)]
        );
        assert_eq!((desk.desktops().len(), desk.here().as_str()), (4, "2"));
        // Removed again, then something moved: the removal is not taken back.
        let again = Edit::RemoveDesktop {
            desktop: "2".into(),
            windows: Windows::Move,
        };
        run(
            &mut desk,
            &mut kept,
            &[
                again,
                Edit::AddDesktop {
                    name: None,
                    go: false,
                },
            ],
        );
        assert_eq!(
            run(&mut desk, &mut kept, &[Edit::UndoDesktop]),
            [json!(false)]
        );
    }

    #[test]
    fn a_removal_that_closed_its_windows_answers_their_plugins_and_is_not_kept() {
        let mut desk = Desk::default();
        let mut kept = Kept::default();
        let edits = [
            Edit::Adopt {
                id: "p.a".into(),
                title: "A".into(),
            },
            Edit::SwitchTo {
                desktop: "2".into(),
            },
            Edit::ShowPlugin { id: "p.a".into() },
            Edit::TogglePin { id: "p.a".into() },
        ];
        run(&mut desk, &mut kept, &edits);
        let removed = Edit::RemoveDesktop {
            desktop: "2".into(),
            windows: Windows::Close,
        };
        let answer = run(&mut desk, &mut kept, &[removed, Edit::UndoDesktop]);
        assert_eq!(answer[0]["closed"], json!(["p.a"]));
        assert_eq!(answer[1], json!(false));
        let last = Edit::RemoveDesktop {
            desktop: "1".into(),
            windows: Windows::Close,
        };
        for _ in 0..3 {
            run(&mut desk, &mut kept, std::slice::from_ref(&last));
        }
        assert_eq!(
            run(&mut desk, &mut kept, &[last]),
            [Value::Null],
            "the last one stays"
        );
    }
}

mod closing {
    use super::*;

    #[test]
    fn a_closed_window_lets_its_plugins_go_with_it_so_none_comes_back_in_its_slot() {
        let mut desk = Desk::default();
        let mut kept = Kept::default();
        let edits = [
            Edit::Adopt {
                id: "p.a".into(),
                title: "A".into(),
            },
            Edit::TogglePin { id: "p.a".into() },
        ];
        run(&mut desk, &mut kept, &edits);
        let closed = run(
            &mut desk,
            &mut kept,
            &[Edit::CloseWindow { id: "p.a".into() }],
        );
        assert_eq!(closed, [json!(["p.a"])]);
        assert!(!desk.holds("p.a") && desk.windows().is_empty());
        // The runtime's own release after it unmounted changes nothing.
        run(&mut desk, &mut kept, &[Edit::Release { id: "p.a".into() }]);
        assert!(desk.windows().is_empty());
    }
}

mod what_the_runtime_reads {
    use super::*;

    #[test]
    fn the_view_has_every_desktops_windows_the_moved_layouts_and_where_the_front_ones_are() {
        let mut desk = Desk::default();
        let mut kept = Kept::default();
        let id = run(&mut desk, &mut kept, &[Edit::NewWindow])[0].clone();
        run(
            &mut desk,
            &mut kept,
            &[Edit::Pan {
                desktop: None,
                to: desk_wm::Offset::new(-100.0, 0.0),
            }],
        );
        let view = View::of(&desk, &kept.arranger, SCREEN);
        assert_eq!(view.here, "1");
        assert_eq!(view.windows["1"][0].id, id.as_str().unwrap());
        assert!(view.windows["2"].is_empty());
        assert!(view.dirty && view.moved.is_some());
        let p = &view.windows["1"][0];
        assert_eq!(view.front[0].rect.x, p.x - 100.0, "on screen at the pan");
        assert_eq!(view.focused_plugin, None, "a launcher is the shell's own");
        assert!(!view.restorable);
        let tiled = run(
            &mut desk,
            &mut kept,
            &[Edit::Arrange {
                kind: desk_wm::ArrangeKind::Tile,
                now: 7,
            }],
        );
        assert_eq!(tiled[0]["kind"], "tile");
        assert!(View::of(&desk, &kept.arranger, SCREEN).restorable);
        let back = run(
            &mut desk,
            &mut kept,
            &[Edit::RestoreArrangement { from: None }],
        );
        assert_eq!(back[0]["windows"], 1);
    }

    #[test]
    fn a_desktop_reordered_by_a_step_and_one_added_and_gone_to() {
        let mut desk = Desk::default();
        let mut kept = Kept::default();
        let reorder = edit(json!({ "op": "reorder-desktop", "desktop": "1", "by": 2 }));
        run(&mut desk, &mut kept, &[reorder]);
        let ids: Vec<&str> = desk.desktops().iter().map(|d| d.id.as_str()).collect();
        assert_eq!(ids, ["2", "3", "1", "4"]);
        let added = run(
            &mut desk,
            &mut kept,
            &[Edit::AddDesktop {
                name: Some("Five".into()),
                go: true,
            }],
        );
        assert_eq!(added, [json!("5")]);
        assert_eq!(desk.here(), "5");
    }
}
