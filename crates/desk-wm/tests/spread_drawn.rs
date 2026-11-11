//! The spread's cards are drawn above the dock (#158), as the compositor draws them: at each slot's
//! pose under the stage's perspective (`drawn_box`, `lifted_box`), not only where their boxes are. A
//! front row's outer cards come forward and turn, and the selected card comes further forward and
//! grows: at 1280×800 a fan of 14 (the default profile's 13 windows and the e2e's hello) drew its
//! selected outer card into the dock, though every box stayed above it.

use desk_wm::{Rect, SpreadModel, SpreadWindow, drawn_box, lifted_box, spread_slots, spread_stage};

/// The dock's top, up from the app's bottom: the bottom edge's 72 px (`plugins/display`) over the
/// status line's 28 px track (`packages/runtime/src/desk.css`).
const DOCK: f64 = 100.0;
/// The app's first size, the smallest it takes, and the others a person's display gives it.
const APPS: [(f64, f64); 7] = [
    (1280.0, 800.0),
    (1024.0, 500.0),
    (1100.0, 600.0),
    (1024.0, 768.0),
    (1440.0, 900.0),
    (1728.0, 1000.0),
    (2560.0, 1440.0),
];

/// `n` windows of the first layout's slot size, as the spread is handed them.
fn windows(n: usize) -> Vec<SpreadWindow> {
    (0..n)
        .map(|i| SpreadWindow {
            id: format!("w{i:02}"),
            title: format!("Window {i}"),
            rect: Rect::new(104.0 + (i % 3) as f64 * 32.0, 190.0, 402.0, 305.0),
            asleep: false,
        })
        .collect()
}

/// The cards of `n` windows that the spread on a `vw`×`vh` app draws into the dock, as they rest
/// and while each is selected.
fn under_the_dock(n: usize, vw: f64, vh: f64, flat: bool) -> Vec<String> {
    let model = SpreadModel::new(windows(n), vw, vh, flat, None);
    (model.shown().iter())
        .filter_map(|w| {
            let slot = model.slot_of(&w.id)?;
            let drawn = drawn_box(&slot, vw, vh);
            let lifted = lifted_box(&slot, vw, vh, flat);
            let past = drawn.bottom().max(lifted.bottom()) > vh - DOCK;
            past.then(|| format!("{} of {n} at {drawn:?}, selected {lifted:?}", w.id))
        })
        .collect()
}

#[test]
fn every_card_is_drawn_above_the_dock_for_every_count_on_every_app_size() {
    for (vw, vh) in APPS {
        for n in 1..=24 {
            for flat in [false, true] {
                let under = under_the_dock(n, vw, vh, flat);
                assert!(under.is_empty(), "{vw}×{vh}, flat {flat}: {under:?}");
            }
        }
    }
}

#[test]
fn fourteen_at_the_first_size_reached_the_dock_on_the_plain_stage() {
    // What the e2e saw (#158): on the stage the boxes were laid out on, the two outer front cards
    // of a fan of 14 are drawn to the dock's top, and selected past it, though their boxes stay
    // above it.
    let (vw, vh) = (1280.0, 800.0);
    let slots = spread_slots(14, spread_stage(vw, vh), false);
    let past: Vec<_> = (slots.iter())
        .filter(|s| lifted_box(s, vw, vh, false).bottom() > vh - DOCK)
        .collect();
    assert_eq!(past.len(), 2, "{past:?}");
    for s in past {
        assert!(s.y + s.h <= vh - DOCK, "its box {s:?} is above the dock");
    }
    assert!(under_the_dock(14, vw, vh, false).is_empty());
}
