use std::time::{Duration, Instant};

use super::{CatchUp, DUE, FED, TIMES};

/// A watch that first saw its view off its size at `t0`, painted `paints` times, no begin frames sent.
fn armed(t0: Instant, paints: u64) -> CatchUp {
    let mut watch = CatchUp::default();
    assert!(!watch.due(t0, false, true, paints, 0));
    watch
}

#[test]
fn a_view_its_page_painted_at_its_size_is_never_due() {
    let t0 = Instant::now();
    let mut watch = CatchUp::default();
    for k in 0..10u32 {
        assert!(!watch.due(t0 + DUE * k, true, true, 1, u64::from(k) * 10));
    }
}

#[test]
fn an_unpainted_size_is_due_once_it_waited_and_was_fed() {
    let t0 = Instant::now();
    let mut watch = armed(t0, 1);
    // Not before `DUE`, however many begin frames went out.
    assert!(!watch.due(t0 + DUE - Duration::from_millis(1), false, true, 1, 100));
    // Not before `FED` begin frames, however long it waited: a clock held is not a page that missed.
    assert!(!watch.due(t0 + DUE * 4, false, true, 1, FED - 1));
    assert!(watch.due(t0 + DUE * 4, false, true, 1, FED));
}

#[test]
fn it_is_told_again_each_due_at_most_times_without_a_paint() {
    let t0 = Instant::now();
    let mut watch = armed(t0, 1);
    let told: u32 = (1..=20u32)
        .map(|k| u32::from(watch.due(t0 + DUE * k, false, true, 1, u64::from(k) * FED)))
        .sum();
    assert_eq!(told, TIMES);
}

#[test]
fn a_tell_waits_a_new_due_after_the_last() {
    let t0 = Instant::now();
    let mut watch = armed(t0, 1);
    assert!(watch.due(t0 + DUE, false, true, 1, FED));
    assert!(!watch.due(t0 + DUE + DUE / 2, false, true, 1, FED * 4));
    assert!(watch.due(t0 + DUE * 2, false, true, 1, FED * 4));
}

#[test]
fn a_page_that_paints_while_its_size_moves_is_never_due() {
    // A drag or a glide: a new size every frame, painted a frame or two late.
    let t0 = Instant::now();
    let mut watch = CatchUp::default();
    for k in 0..200u32 {
        let now = t0 + Duration::from_millis(16) * k;
        assert!(!watch.due(now, false, true, u64::from(k / 2), u64::from(k)));
    }
}

#[test]
fn a_page_that_paints_nothing_while_its_size_moves_is_due() {
    // The desk's own page in a live resize of the app window: its size moves, its page is stuck.
    let t0 = Instant::now();
    let mut watch = armed(t0, 7);
    let due = (1..=40u32).find(|&k| {
        let now = t0 + Duration::from_millis(16) * k;
        watch.due(now, false, true, 7, u64::from(k))
    });
    assert_eq!(due, Some(16), "the first look `DUE` after its last paint");
}

#[test]
fn a_paint_starts_the_wait_and_the_count_again() {
    let t0 = Instant::now();
    let mut watch = armed(t0, 1);
    for k in 1..=TIMES {
        assert!(watch.due(t0 + DUE * k, false, true, 1, u64::from(k) * FED));
    }
    // A paint at a size between: the page moves again, so a new wait with tellings of its own.
    let t1 = t0 + DUE * 10;
    assert!(!watch.due(t1, false, true, 2, 100));
    assert!(!watch.due(t1 + DUE / 2, false, true, 2, 100 + FED));
    assert!(watch.due(t1 + DUE, false, true, 2, 100 + FED));
}

#[test]
fn a_paint_at_its_size_ends_the_wait() {
    let t0 = Instant::now();
    let mut watch = armed(t0, 1);
    assert!(!watch.due(t0 + DUE / 2, true, true, 2, FED));
    // Its next size starts a wait of its own.
    assert!(!watch.due(t0 + DUE, false, true, 2, FED * 2));
    assert!(!watch.due(t0 + DUE + DUE / 2, false, true, 2, FED * 4));
    assert!(watch.due(t0 + DUE * 2, false, true, 2, FED * 4));
}

#[test]
fn a_painted_size_that_comes_back_between_others_does_not_end_the_wait() {
    // A live resize back and forth over a stuck page: its last painted size comes back for a moment.
    let t0 = Instant::now();
    let mut watch = armed(t0, 1);
    let step = DUE / 5;
    assert!(!watch.due(t0 + step, true, true, 1, FED));
    assert!(!watch.due(t0 + step * 2, true, true, 1, FED));
    assert!(!watch.due(t0 + step * 3, false, true, 1, FED * 2));
    assert!(watch.due(t0 + step * 5, false, true, 1, FED * 3));
}

#[test]
fn a_painted_size_that_stays_ends_the_wait() {
    let t0 = Instant::now();
    let mut watch = armed(t0, 1);
    assert!(!watch.due(t0 + DUE / 5, true, true, 1, FED));
    assert!(!watch.due(t0 + DUE + DUE / 5, true, true, 1, FED * 2));
    // Off its size again much later: a wait of its own, not one long overdue.
    let later = t0 + DUE * 10;
    assert!(!watch.due(later, false, true, 1, FED * 3));
    assert!(!watch.due(later + DUE / 2, false, true, 1, FED * 6));
    assert!(watch.due(later + DUE, false, true, 1, FED * 6));
}

#[test]
fn a_hidden_view_waits_for_nothing_and_its_show_starts_the_wait() {
    let t0 = Instant::now();
    let mut watch = armed(t0, 1);
    assert!(!watch.due(t0 + DUE * 2, false, false, 1, FED * 2));
    let shown = t0 + DUE * 5;
    assert!(!watch.due(shown, false, true, 1, FED * 2));
    assert!(!watch.due(shown + DUE / 2, false, true, 1, FED * 4));
    assert!(watch.due(shown + DUE, false, true, 1, FED * 4));
}
