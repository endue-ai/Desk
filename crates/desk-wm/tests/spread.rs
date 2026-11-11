//! Ported from `packages/runtime/src/arrange/geometry.test.ts` ("the spread") and
//! `arrange/spread.test.ts`, the spread of ADR 0116.
//!
//! `spread.test.ts` drives the controller (`arrange/spread.ts`): the store, the frame loop and a
//! view that records each frame. Its cases are ported to what the model decides: the selection, the
//! filter, the actions keys give, the camera and the poses every window is drawn at when a motion
//! ends. Running a motion between poses (`mix` over the injected clock), giving the focus once the
//! spread has closed and drawing the frames are the compositor's spread (#54).

use desk_wm::{
    Adopted, IDENTITY, KeyPress, Offset, Placement, Pose, Rect, SpreadAction, SpreadModel,
    SpreadWindow, asleep, fan_rows, flat_slots, mix, screen_rect, slot_windows, spread_slots,
    spread_stage,
};

mod the_spread {
    use super::*;

    #[test]
    fn gives_the_same_places_for_the_same_count_every_time() {
        let stage = spread_stage(1440.0, 900.0);
        for n in 1..=12 {
            assert_eq!(spread_slots(n, stage, false), spread_slots(n, stage, false));
            assert_eq!(spread_slots(n, stage, false).len(), n);
        }
    }

    #[test]
    fn fans_a_few_windows_in_one_curved_row_and_many_in_layers_further_back() {
        let stage = spread_stage(1440.0, 900.0);
        assert_eq!(fan_rows(3, stage), [3]);
        assert_eq!(fan_rows(4, stage), [2, 2]);
        assert_eq!(fan_rows(7, stage), [4, 3]);
        assert_eq!(fan_rows(12, stage), [4, 4, 4]);
        let slots = spread_slots(7, stage, false);
        let front: Vec<_> = slots.iter().filter(|s| s.row == 1).collect();
        let back: Vec<_> = slots.iter().filter(|s| s.row == 0).collect();
        for s in &back {
            assert!(s.z < -100.0);
        }
        for s in &front {
            assert!(s.z >= 0.0);
        }
        // The outer cards turn towards the middle; the middle ones face the person.
        assert!(back[0].rotate_y > 0.0);
        assert!(back[back.len() - 1].rotate_y < 0.0);
        let front_lowest = front.iter().map(|s| s.order).min().unwrap();
        let back_highest = back.iter().map(|s| s.order).max().unwrap();
        assert!(front_lowest > back_highest);
        for s in &slots {
            assert!(s.x >= stage.x);
            assert!(s.x + s.w <= stage.x + stage.w + 0.01);
        }
    }

    #[test]
    fn lays_the_same_count_out_flat_with_no_turn_and_no_depth_when_motion_is_reduced() {
        let stage = spread_stage(1440.0, 900.0);
        let flat = spread_slots(7, stage, true);
        assert_eq!(flat, flat_slots(7, stage));
        for s in &flat {
            assert_eq!([s.z, s.rotate_y, s.rotate_x], [0.0, 0.0, 0.0]);
        }
        for (i, a) in flat.iter().enumerate() {
            for b in &flat[i + 1..] {
                assert!(!a.rect().overlaps(&b.rect()));
            }
        }
    }
}

const VIEW: (f64, f64) = (1440.0, 900.0);

fn title(id: &str) -> &str {
    match id {
        "a" => "Calendar",
        "b" => "Notes",
        "c" => "Mail",
        "d" => "Terminal",
        "e" => "Files",
        "p.one" => "Counter",
        "p.two" => "Hello",
        other => other,
    }
}

/// Five windows in two rows, as the spread reads them: a b c on top, d e under them.
fn layout() -> Vec<Placement> {
    [
        ("a", 100.0, 100.0),
        ("b", 600.0, 100.0),
        ("c", 1100.0, 100.0),
    ]
    .into_iter()
    .chain([("d", 100.0, 500.0), ("e", 600.0, 500.0)])
    .map(|(id, x, y)| Placement::new(id, "endue.notes", Rect::new(x, y, 640.0, 420.0)))
    .collect()
}

/// `spreadWindows`: each window where it is drawn now; none covered or unloaded.
fn windows(placements: &[Placement]) -> Vec<SpreadWindow> {
    placements
        .iter()
        .map(|p| SpreadWindow {
            id: p.id.clone(),
            title: title(&p.id).into(),
            rect: screen_rect(p, Offset::new(0.0, 0.0), VIEW.0, VIEW.1),
            asleep: false,
        })
        .collect()
}

/// `spread.open()` with "b" in focus: the model, its selected card brought into sight.
fn open(flat: bool) -> SpreadModel {
    let mut model = SpreadModel::new(windows(&layout()), VIEW.0, VIEW.1, flat, Some("b"));
    model.keep_in_view();
    model
}

fn press(model: &mut SpreadModel, key: &str) -> SpreadAction {
    model.key(&KeyPress::new(key))
}

fn shown(model: &SpreadModel) -> Vec<&str> {
    model.shown().iter().map(|w| w.id.as_str()).collect()
}

mod the_spreads_keys {
    use super::*;

    #[test]
    fn move_the_selection_along_the_rows_between_them_and_in_order_with_tab() {
        let mut spread = open(false);
        // It opens on the focused window.
        assert_eq!(spread.selected(), Some("b"));
        let mut walk = |key: &str, shift: bool, then: &str| {
            let k = KeyPress::new(key);
            let k = if shift { k.with_shift() } else { k };
            assert_eq!(spread.key(&k), SpreadAction::Moved);
            assert_eq!(spread.selected(), Some(then), "{key}");
        };
        walk("ArrowRight", false, "c");
        // At the end of a row the next key goes on to the next row.
        walk("ArrowRight", false, "d");
        walk("ArrowUp", false, "a");
        walk("ArrowDown", false, "d");
        walk("ArrowLeft", false, "c");
        walk("Tab", false, "d");
        walk("Tab", false, "e");
        walk("Tab", false, "a");
        walk("Tab", true, "e");
        walk("Home", false, "a");
        walk("End", false, "e");
    }

    #[test]
    fn enter_focuses_the_selected_window_and_the_windows_go_back() {
        let mut spread = open(false);
        press(&mut spread, "ArrowRight");
        assert_eq!(
            press(&mut spread, "Enter"),
            SpreadAction::Choose { id: "c".into() }
        );
        // Going back ends with every window where it was.
        for pose in spread.poses().values() {
            assert_eq!(mix(*pose, IDENTITY, 1.0), IDENTITY);
        }
    }

    #[test]
    fn escape_cancels_the_focus_stays_where_it_was() {
        let mut spread = open(false);
        press(&mut spread, "ArrowDown");
        assert_eq!(press(&mut spread, "Escape"), SpreadAction::Cancel);
    }

    #[test]
    fn typing_filters_by_title_and_enter_opens_what_is_left_selected() {
        let mut spread = open(false);
        spread.set_filter("NO");
        assert_eq!(shown(&spread), ["b"]);
        spread.set_filter("i");
        // Mail, Terminal, Files, now one row left to right; the selection moves to the first of
        // them.
        assert_eq!(shown(&spread), ["d", "e", "c"]);
        assert_eq!(spread.selected(), Some("d"));
        let poses = spread.poses();
        assert_eq!(poses["b"].opacity, 0.0);
        assert_eq!(poses["d"].opacity, 1.0);
        spread.set_filter("zzz");
        assert_eq!(spread.selected(), None);
        assert_eq!(press(&mut spread, "Enter"), SpreadAction::None);
        spread.set_filter("term");
        assert_eq!(
            press(&mut spread, "Enter"),
            SpreadAction::Choose { id: "d".into() }
        );
    }
}

mod what_the_spread_shows {
    use super::*;

    #[test]
    fn puts_a_placeholder_on_covered_and_unloaded_windows_and_moves_nothing_on_the_desk() {
        let adopted = [("p.one", 0), ("p.two", 1)].map(|(id, slot)| Adopted {
            id: id.into(),
            title: title(id).into(),
            slot: Some(slot),
            at: None,
            area: None,
        });
        let mut desk = layout();
        desk.extend(slot_windows(&adopted, |_| false));
        let before = desk.clone();
        let covered = |plugin: &str| plugin == "p.one";
        let unloaded = |id: &str| id == "a";
        let mut spread_windows = windows(&desk);
        for (w, p) in spread_windows.iter_mut().zip(&desk) {
            let plugins = desk_wm::shown_plugins(p, |id| adopted.iter().any(|a| a.id == id));
            w.asleep = asleep(unloaded(&p.id), &plugins, covered);
        }
        let spread = SpreadModel::new(spread_windows, VIEW.0, VIEW.1, false, Some("b"));
        let mut sleeping: Vec<&str> = spread
            .windows()
            .iter()
            .filter(|w| w.asleep)
            .map(|w| w.id.as_str())
            .collect();
        sleeping.sort();
        // p.one's only frame is covered and a's was unloaded; p.two shows, b is the shell's own
        // view.
        assert_eq!(sleeping, ["a", "p.one"]);
        assert_eq!(desk, before);
    }

    #[test]
    fn fans_the_windows_out_in_depth_over_its_opening_motion() {
        let spread = open(false);
        let poses: Vec<Pose> = spread.poses().into_values().collect();
        // The first frame is where the windows are.
        for pose in &poses {
            assert_eq!(mix(IDENTITY, *pose, 0.0), IDENTITY);
        }
        assert!(poses.iter().any(|p| p.rotate_y != 0.0));
        assert!(poses.iter().any(|p| p.z < -100.0));
        assert!(poses.iter().all(|p| p.scale < 1.0));
    }

    #[test]
    fn lays_the_windows_out_flat_at_once_when_motion_is_reduced() {
        let spread = open(true);
        assert!(spread.flat());
        for p in spread.poses().values() {
            assert_eq!([p.rotate_y, p.rotate_x, p.z], [0.0, 0.0, 0.0]);
            assert!(p.scale < 1.0);
        }
    }

    #[test]
    fn pans_and_zooms_about_the_pointer() {
        let mut spread = open(true);
        spread.zoom_at(2.0, 300.0, 200.0);
        assert_eq!(spread.camera().zoom, 2.0);
        // The point under the pointer stays put: (300 - 720) * 2 + x = 300 - 720.
        assert_eq!(spread.camera().x, 420.0);
        assert_eq!(spread.camera().y, 250.0);
        spread.pan(-20.0, 10.0);
        let c = spread.camera();
        assert_eq!((c.x, c.y, c.zoom), (400.0, 260.0, 2.0));
        spread.zoom_at(100.0, 0.0, 0.0);
        assert_eq!(spread.camera().zoom, 2.5);
    }
}
