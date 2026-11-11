use super::{
    COLD, Clock, Copies, FRAME, Heard, LONG_IDLE, asked, heard, on_clock, prompts, take_heard,
};
use crate::web_host::lifecycle::State;
use std::time::{Duration, Instant};

#[test]
fn the_clock_numbers_its_frames_never_makes_up_a_late_one_and_starts_at_once() {
    let mut clock = Clock::default();
    let t0 = Instant::now();
    assert_eq!(clock.next(), None);
    assert_eq!(
        clock.frame(t0),
        Some(0),
        "a stopped clock's first frame is at once"
    );
    assert_eq!(clock.frame(t0 + FRAME / 2), None);
    assert_eq!(clock.frame(t0 + FRAME), Some(1));
    assert_eq!(clock.next(), Some(t0 + FRAME * 2));
    assert_eq!(
        clock.frame(t0 + FRAME * 5),
        Some(5),
        "late: the ones between are skipped"
    );
    assert_eq!(clock.next(), Some(t0 + FRAME * 6), "and not made up");
    assert_eq!(clock.frame(t0 + FRAME * 5 + FRAME / 2), None);
    let behind = t0 + FRAME * 7 + FRAME * 3 / 4;
    assert_eq!(clock.frame(behind), Some(7));
    assert_eq!(
        clock.next(),
        Some(behind + FRAME),
        "half a frame late starts again from it"
    );
    clock.stop();
    assert_eq!(clock.next(), None);
    assert_eq!(clock.frame(behind), Some(0));
}

#[test]
fn only_visible_awake_surfaces_are_on_the_clock_presses_prompt_and_the_clock_hears_them() {
    assert!(on_clock(State::Live { hidden: false }));
    for state in [
        State::Live { hidden: true },
        State::Asleep { hidden: false },
        State::Dead { hidden: false },
        State::Gone,
    ] {
        assert!(!on_clock(state), "{state:?}");
    }
    let message = |value: serde_json::Value| serde_json::from_value(value).unwrap();
    let press = serde_json::json!({ "type": "pointer.down", "surface": "s", "x": 1, "y": 1,
        "button": "left", "buttons": [], "clicks": 1, "modifiers": [] });
    let moved = serde_json::json!({ "type": "pointer.move", "surface": "s", "x": 1, "y": 1,
        "buttons": [], "modifiers": [] });
    assert!(prompts(&message(press)));
    assert!(
        !prompts(&message(moved)),
        "moves paint on the desk's frames"
    );
    // Other tests may hear too: look for this one's browser only.
    heard(-117, true);
    heard(-118, false);
    asked(-119, Some(Duration::from_millis(2000)));
    asked(-120, None);
    let got: Vec<(i32, Heard)> = take_heard()
        .into_iter()
        .filter(|(id, _, _)| *id <= -117)
        .map(|(id, _, what)| (id, what))
        .collect();
    assert_eq!(
        got,
        [
            (-117, Heard::Prompt),
            (-118, Heard::Woken),
            (-119, Heard::Asked(Some(Duration::from_millis(2000)))),
            (-120, Heard::Asked(None))
        ]
    );
}

#[test]
fn input_to_a_desk_that_painted_nothing_for_a_while_wakes_the_gpus_copies_once() {
    let t0 = Instant::now();
    let mut copies = Copies::default();
    assert!(copies.wake(t0), "nothing painted yet: cold");
    assert!(!copies.wake(t0 + COLD / 2), "the wake-up counts as a copy");
    assert!(copies.wake(t0 + COLD), "cold again {COLD:?} later");
    let painted = t0 + COLD * 3;
    copies.copied(painted);
    copies.copied(painted - FRAME);
    assert!(
        !copies.wake(painted + COLD - FRAME),
        "a paint is a copy, and the latest counts"
    );
    assert!(copies.wake(painted + COLD));
    assert!(COLD < LONG_IDLE, "woken well before a second without one");
}
