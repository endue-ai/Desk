//! Ported from `packages/runtime/src/arrange/commands.test.ts`: tile and cascade as one undoable
//! step each (ADR 0116), case by case. The TS cases run the commands on the bridge stub's core,
//! whose undo stack hands the arrangement's answer to `desk.windows.restore-arrangement`; here the
//! `Arranger` is asked directly, the answer in hand. The registration case ("register as
//! undoable") and the spread's toggle are the commands' wiring (#82), not the model's.

mod common;

use std::collections::BTreeMap;

use common::*;
use desk_wm::{
    ArrangeKind, Arranged, Arranger, CASCADE, Desk, Fill, Offset, Rect, Restore, arrange_area,
    cascade_rects, tile_rects,
};

/// `commands.test.ts`'s desk: four windows on desktop 1 (one filled to the left, one floating, one
/// pinned), two on desktop 2, a plugin window in its slot, the calendar in use.
fn arranged_desk() -> Desk {
    let mut calendar = at("calendar", "endue.notes", 10.0, 20.0, 400.0, 300.0);
    calendar.fill = Some(Fill::Left);
    calendar.restore = Some(Restore {
        x: 1.0,
        y: 2.0,
        w: 300.0,
        h: 200.0,
        ..Restore::default()
    });
    let mut reference = at("reference", "endue.notes", 50.0, 60.0, 400.0, 300.0);
    reference.floating = Some(true);
    let mut pinned = at("pinned", "endue.notes", 900.0, 500.0, 400.0, 300.0);
    pinned.pinned = true;
    let notes = at("notes", "endue.notes", 300.0, 200.0, 400.0, 300.0);
    let mut desk = sample(1_794_042_000_000);
    desk.set(|d| {
        d.session
            .insert("1".into(), layout(vec![calendar, notes, reference, pinned]));
        d.session.insert(
            "2".into(),
            layout(vec![
                at("tomorrow", "endue.notes", 700.0, 300.0, 400.0, 300.0),
                at("keys", "endue.notes", 20.0, 30.0, 400.0, 300.0),
            ]),
        );
        d.focused = Some("calendar".into());
    });
    adopt(&mut desk, &["p.counter"]);
    desk
}

/// Each window's geometry as a desktop draws it: rect, fill and restore.
type Geo = (Rect, Option<Fill>, Option<Restore>);

fn rects(d: &Desk, desktop: &str) -> BTreeMap<String, Geo> {
    d.windows_of(desktop)
        .into_iter()
        .map(|p| (p.id.clone(), (p.rect(), p.fill, p.restore)))
        .collect()
}

fn boxed(r: Rect) -> Geo {
    (r, None, None)
}

const WALL: i64 = 1_794_042_000_000;

fn arrange(d: &mut Desk, a: &mut Arranger, kind: ArrangeKind) -> Option<Arranged> {
    a.arrange(d, kind, 1440.0, 900.0, 12.0, WALL)
}

fn area() -> Rect {
    arrange_area(1440.0, 900.0, true)
}

mod desk_windows_tile_and_desk_windows_cascade {
    use super::*;

    #[test]
    fn tile_only_the_normal_windows_on_the_current_desktop_floating_and_pinned_ones_stay() {
        let (mut d, mut a) = (arranged_desk(), Arranger::default());
        let before = rects(&d, "1");
        let other = rects(&d, "2");
        let done = arrange(&mut d, &mut a, ArrangeKind::Tile).expect("tiled");
        let grid = tile_rects(3, area(), 12.0);
        let now = rects(&d, "1");
        // In desk order: the plugin window in its slot first, under what the layout places (#158).
        assert_eq!(now["p.counter"], boxed(grid[0]));
        assert_eq!(now["calendar"], boxed(grid[1]));
        assert_eq!(now["notes"], boxed(grid[2]));
        assert_eq!(now["reference"], before["reference"]);
        assert_eq!(now["pinned"], before["pinned"]);
        // Desktop 2's own windows stay; the plugin window, placed on desktop 1 by the tile, now
        // lives there and leaves the others (ADR 0117).
        let mut kept = other.clone();
        kept.remove("p.counter");
        assert_eq!(rects(&d, "2"), kept);
        assert!(other.contains_key("p.counter"));
        // The plugin window entered the layout where it was tiled; the floating one still floats.
        let placed = d.layout().surfaces;
        assert!(placed.iter().any(|p| p.id == "p.counter"));
        let floating = placed.iter().find(|p| p.id == "reference");
        assert_eq!(floating.and_then(|p| p.floating), Some(true));
        assert_eq!((done.desktop.as_str(), done.kind), ("1", ArrangeKind::Tile));
    }

    #[test]
    fn cascade_the_same_size_from_the_top_left_the_focused_window_last_and_on_top() {
        let (mut d, mut a) = (arranged_desk(), Arranger::default());
        arrange(&mut d, &mut a, ArrangeKind::Cascade).expect("cascaded");
        let steps = cascade_rects(3, area(), CASCADE);
        let now = rects(&d, "1");
        assert_eq!(now["p.counter"], boxed(steps[0]));
        assert_eq!(now["notes"], boxed(steps[1]));
        assert_eq!(now["calendar"], boxed(steps[2]));
        // Desk order is the stacking order: the cascade's order, whichever window is focused next.
        let order: Vec<String> = d
            .windows()
            .into_iter()
            .filter(|p| p.floating != Some(true) && !p.pinned)
            .map(|p| p.id)
            .collect();
        assert_eq!(order, ["p.counter", "notes", "calendar"]);
    }

    #[test]
    fn refuse_a_desktop_with_no_normal_window_and_leave_nothing_to_undo() {
        let (mut d, mut a) = (arranged_desk(), Arranger::default());
        d.set(|s| {
            s.desktop = "3".into();
            s.adopted.clear();
        });
        assert!(arrange(&mut d, &mut a, ArrangeKind::Tile).is_none());
        assert!(!a.can_restore(&d, None));
    }
}

mod undo_and_restore {
    use super::*;

    #[test]
    fn cmd_undo_puts_the_previous_geometry_back_as_one_step_and_cmd_redo_tiles_again() {
        let (mut d, mut a) = (arranged_desk(), Arranger::default());
        let session = d.session.clone();
        let before = rects(&d, "1");
        let done = arrange(&mut d, &mut a, ArrangeKind::Tile).expect("tiled");
        assert_ne!(rects(&d, "1"), before);
        let undone = a.restore(&mut d, Some(&done)).expect("restored");
        assert_eq!(undone.entry, done.entry);
        assert_eq!(rects(&d, "1"), before);
        // Nothing else changed in between: the desktop is exactly as it was, unsaved edits included.
        assert_eq!(d.session, session);
        arrange(&mut d, &mut a, ArrangeKind::Tile).expect("tiled again");
        assert_eq!(
            rects(&d, "1")["notes"],
            boxed(tile_rects(3, area(), 12.0)[2])
        );
    }

    #[test]
    fn restore_after_a_later_move_puts_back_each_arranged_windows_geometry_and_keeps_the_rest() {
        let (mut d, mut a) = (arranged_desk(), Arranger::default());
        let before = rects(&d, "1");
        arrange(&mut d, &mut a, ArrangeKind::Tile).expect("tiled");
        d.move_surface("reference", Offset::new(77.0, 88.0));
        a.restore(&mut d, None).expect("restored");
        let now = rects(&d, "1");
        for id in ["calendar", "notes", "p.counter", "pinned"] {
            assert_eq!(now[id], before[id], "{id}");
        }
        assert_eq!((now["reference"].0.x, now["reference"].0.y), (77.0, 88.0));
    }

    #[test]
    fn works_per_desktop_after_switching_desktops() {
        let (mut d, mut a) = (arranged_desk(), Arranger::default());
        let one = rects(&d, "1");
        arrange(&mut d, &mut a, ArrangeKind::Tile).expect("tiled");
        let tiled_one = rects(&d, "1");
        // Desktop 2 as the tile on desktop 1 left it: the plugin window it placed lives on 1.
        let two = rects(&d, "2");
        d.set_desktop("2");
        assert!(!a.can_restore(&d, None));
        arrange(&mut d, &mut a, ArrangeKind::Cascade).expect("cascaded");
        assert_ne!(rects(&d, "2"), two);
        a.restore(&mut d, None).expect("restored");
        assert_eq!(rects(&d, "2"), two);
        assert_eq!(rects(&d, "1"), tiled_one);
        assert!(a.restore(&mut d, None).is_none(), "no earlier layout");
        d.set_desktop("1");
        assert!(a.can_restore(&d, None));
        a.restore(&mut d, None).expect("restored");
        assert_eq!(rects(&d, "1"), one);
    }

    #[test]
    fn an_undo_of_an_arrangement_already_restored_does_nothing() {
        let (mut d, mut a) = (arranged_desk(), Arranger::default());
        let before = rects(&d, "1");
        let done = arrange(&mut d, &mut a, ArrangeKind::Tile).expect("tiled");
        a.restore(&mut d, None).expect("restored");
        d.move_surface("notes", Offset::new(5.0, 6.0));
        assert!(a.restore(&mut d, Some(&done)).is_none());
        assert_eq!(
            (rects(&d, "1")["notes"].0.x, rects(&d, "1")["notes"].0.y),
            (5.0, 6.0)
        );
        assert_eq!(rects(&d, "1")["calendar"], before["calendar"]);
    }

    #[test]
    fn an_arrangement_this_desk_no_longer_holds_comes_back_from_its_answer() {
        let (mut d, mut a) = (arranged_desk(), Arranger::default());
        let before = rects(&d, "1");
        let done = arrange(&mut d, &mut a, ArrangeKind::Tile).expect("tiled");
        // A reload under a core that kept its undo stack: a fresh arranger, the answer kept.
        let answer: Arranged =
            serde_json::from_value(serde_json::to_value(&done).unwrap()).unwrap();
        let restored = Arranger::default().restore(&mut d, Some(&answer));
        assert_eq!(restored.map(|r| r.windows), Some(3));
        assert_eq!(rects(&d, "1")["notes"], before["notes"]);
        assert_eq!(rects(&d, "1")["calendar"], before["calendar"]);
    }
}
