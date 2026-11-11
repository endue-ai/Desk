//! The first layout fits the app (#158, #159, #160, #162): the plugin windows a fresh desk opens in
//! their slots, tile, cascade and the spread stay inside the app, clear of the side bars and above
//! the dock. At 1280×800 the slots of the 1440×900 reference frame put a third column past the
//! right edge and the second row under the dock, and tile and the spread laid their last row under
//! it.

use desk_wm::edits::{Edit, Kept, apply};
use desk_wm::{
    ArrangeKind, Desk, MIN, Rect, SAFE, Size, View, flat_slots, spread_slots, spread_stage,
};

/// The dock's band, up from the app's bottom: the bottom edge's 72 px (`plugins/display`) over the
/// status line's 28 px track (`packages/runtime/src/desk.css`).
const DOCK: f64 = 100.0;
/// Where Eris sits at home ends, and where windows start under her.
const BELOW_ERIS: f64 = 190.0;
/// The default profile's fourteen plugin windows, in the order they mount.
const PLUGINS: [&str; 14] = [
    "endue.calendar",
    "endue.chat",
    "endue.database",
    "endue.docker",
    "endue.eris",
    "endue.explorer",
    "endue.git",
    "endue.mail",
    "endue.notes",
    "endue.permissions",
    "endue.projects",
    "endue.sidebar",
    "endue.terminal",
    "endue.toolbar",
];

const fn size(w: f64, h: f64) -> Size {
    Size { w, h }
}
/// The app's first size and the others a person's display gives it.
const APPS: [Size; 5] = [
    size(1280.0, 800.0),
    size(1440.0, 900.0),
    size(1024.0, 768.0),
    size(1728.0, 1000.0),
    size(2560.0, 1440.0),
];

/// A fresh desk on a `screen`-sized app with `ids` handed over in order, as the runtime mounts them.
fn opened(screen: Size, ids: &[&str]) -> (Desk, Kept) {
    let (mut desk, mut kept) = (Desk::default(), Kept::default());
    for id in ids {
        let edit = Edit::Adopt {
            id: (*id).into(),
            title: (*id).into(),
        };
        apply(&mut desk, &mut kept, &edit, screen);
    }
    (desk, kept)
}

/// Where each window of the desktop in front is drawn, by id.
fn drawn(desk: &Desk, kept: &Kept, screen: Size) -> Vec<(String, Rect)> {
    let view = View::of(desk, &kept.arranger, screen);
    view.front.into_iter().map(|s| (s.id, s.rect)).collect()
}

/// `r` lies between the side bars, under Eris and above the dock of a `screen`-sized app.
fn assert_clear(id: &str, r: Rect, screen: Size) {
    let what = format!("{id} at {r:?} on {}×{}", screen.w, screen.h);
    assert!(r.x >= SAFE.left, "{what}: under the agent bar");
    assert!(r.right() <= screen.w - SAFE.right, "{what}: past the rail");
    assert!(r.y >= BELOW_ERIS, "{what}: under Eris");
    assert!(r.bottom() <= screen.h - DOCK, "{what}: under the dock");
}

mod windows_in_their_slots {
    use super::*;

    #[test]
    fn the_default_fourteen_lie_inside_the_app_above_the_dock_on_every_first_size() {
        for screen in APPS {
            let (desk, kept) = opened(screen, &PLUGINS);
            let windows = drawn(&desk, &kept, screen);
            assert_eq!(windows.len(), PLUGINS.len());
            for (id, r) in &windows {
                assert_clear(id, *r, screen);
            }
        }
    }

    #[test]
    fn no_two_of_them_have_their_title_bar_at_the_same_place() {
        for screen in APPS {
            let (desk, kept) = opened(screen, &PLUGINS);
            let windows = drawn(&desk, &kept, screen);
            for (i, (a, ra)) in windows.iter().enumerate() {
                for (b, rb) in &windows[i + 1..] {
                    assert!((ra.x, ra.y) != (rb.x, rb.y), "{a} and {b} at {ra:?}");
                }
            }
        }
    }

    #[test]
    fn a_window_keeps_its_place_when_the_app_resizes_and_the_next_one_opens_in_the_new_size() {
        let small = size(1280.0, 800.0);
        let (mut desk, mut kept) = opened(small, &PLUGINS[..3]);
        let before = drawn(&desk, &kept, small);
        // The app grows: the canvas keeps its windows where they were.
        let large = size(1728.0, 1000.0);
        let after = drawn(&desk, &kept, large);
        assert_eq!(before, after);
        // A window handed over now opens in a slot of the app as it is.
        let edit = Edit::Adopt {
            id: "endue.notes".into(),
            title: "Notes".into(),
        };
        apply(&mut desk, &mut kept, &edit, large);
        let now = drawn(&desk, &kept, large);
        let (_, notes) = now.iter().find(|(id, _)| id == "endue.notes").unwrap();
        let (_, first) = &before[0];
        assert!(notes.w > first.w, "{notes:?} is laid in the larger app");
        assert_clear("endue.notes", *notes, large);
    }

    #[test]
    fn handed_over_again_a_window_keeps_its_slot_and_its_place() {
        let first = size(1280.0, 800.0);
        let (mut desk, mut kept) = opened(first, &PLUGINS[..2]);
        let before = drawn(&desk, &kept, first);
        let again = Edit::Adopt {
            id: PLUGINS[0].into(),
            title: "Calendar".into(),
        };
        apply(&mut desk, &mut kept, &again, size(1728.0, 1000.0));
        let after = drawn(&desk, &kept, first);
        let place = |list: &[(String, Rect)], id: &str| list.iter().find(|(w, _)| w == id).cloned();
        assert_eq!(place(&after, PLUGINS[0]), place(&before, PLUGINS[0]));
    }
}

mod arranged {
    use super::*;

    #[test]
    fn tile_and_cascade_keep_every_window_above_the_dock() {
        for screen in APPS {
            for kind in [ArrangeKind::Tile, ArrangeKind::Cascade] {
                let (mut desk, mut kept) = opened(screen, &PLUGINS);
                let edit = Edit::Arrange { kind, now: 1 };
                apply(&mut desk, &mut kept, &edit, screen);
                for (id, r) in drawn(&desk, &kept, screen) {
                    assert_clear(&id, r, screen);
                }
            }
        }
    }

    #[test]
    fn the_spread_lays_every_card_above_the_dock_curved_or_flat() {
        for screen in APPS {
            let stage = spread_stage(screen.w, screen.h);
            let above = screen.h - DOCK;
            for n in 1..=24 {
                for slot in spread_slots(n, stage, false)
                    .iter()
                    .chain(&flat_slots(n, stage))
                {
                    let box_ = slot.rect();
                    assert!(box_.bottom() <= above, "{n} cards: {box_:?} under the dock");
                    assert!(box_.w > 0.0 && box_.h > 0.0);
                }
            }
        }
    }

    #[test]
    fn a_window_in_a_slot_is_never_below_the_minimum_size() {
        for screen in [size(1024.0, 500.0), size(1100.0, 600.0)] {
            let (desk, kept) = opened(screen, &PLUGINS);
            for (id, r) in drawn(&desk, &kept, screen) {
                assert!(r.w >= MIN.w && r.h >= MIN.h, "{id} at {r:?}");
                assert!(r.x >= 0.0 && r.right() <= screen.w, "{id} at {r:?}");
            }
        }
    }
}
