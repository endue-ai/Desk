//! When a desk checks by itself.

use std::time::Duration;

use desk_update::schedule::Schedule;

const HOUR: u64 = 60 * 60;

#[test]
fn waits_after_start_then_checks_every_four_hours() {
    let mut schedule = Schedule::default();
    assert_eq!(schedule.first(), Duration::from_secs(30));
    assert_eq!(schedule.next(true, 0.0), Duration::from_secs(4 * HOUR));
    assert_eq!(
        schedule.next(true, 1.0),
        Duration::from_secs(4 * HOUR).mul_f64(1.1)
    );
    assert_eq!(
        schedule.next(true, -1.0),
        Duration::from_secs(4 * HOUR).mul_f64(0.9)
    );
    assert_eq!(
        schedule.next(true, 7.0),
        Duration::from_secs(4 * HOUR).mul_f64(1.1),
        "clamped"
    );
}

#[test]
fn backs_off_after_failures() {
    let mut schedule = Schedule::default();
    let waits: Vec<u64> = (0..5)
        .map(|_| schedule.next(false, 0.0).as_secs())
        .collect();
    assert_eq!(waits, [60, 5 * 60, 30 * 60, 4 * HOUR, 4 * HOUR]);
    assert_eq!(schedule.next(true, 0.0).as_secs(), 4 * HOUR);
    assert_eq!(
        schedule.next(false, 0.0).as_secs(),
        60,
        "a success starts the backoff over"
    );
}
