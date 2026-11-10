use super::{MAX_DELAY, Pump, REST_DELAY};
use std::time::{Duration, Instant};

#[test]
fn work_is_due_at_once_then_not_before_it_is_asked_for_or_the_poll() {
    let pump = Pump::new(None);
    let now = Instant::now();
    assert!(pump.take_due(now), "the first call runs at once");
    assert!(!pump.take_due(now + Duration::from_millis(5)));
    assert!(
        pump.take_due(now + MAX_DELAY),
        "the poll, with the desk waking often"
    );
}

#[test]
fn without_an_event_loop_a_schedule_unparks_the_waiting_thread() {
    let pump = Pump::new(None);
    pump.wake_thread(std::thread::current());
    let other = pump.clone();
    let started = Instant::now();
    let scheduler = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(20));
        other.schedule(0);
    });
    std::thread::park_timeout(Duration::from_secs(5));
    scheduler.join().unwrap();
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "woken by the schedule, not the timeout"
    );
}

#[test]
fn what_cef_asks_for_wins_and_a_long_wait_is_kept_as_asked() {
    let pump = Pump::new(None);
    assert!(pump.take_due(Instant::now()));
    pump.schedule(0);
    assert!(pump.due() <= Instant::now(), "zero means now");
    assert!(pump.take_due(Instant::now()));
    pump.schedule(60_000);
    assert!(
        pump.due() <= Instant::now() + MAX_DELAY,
        "the poll comes first"
    );
    let wake = pump.wake_at(None);
    assert!(
        wake > Instant::now() + MAX_DELAY && wake <= Instant::now() + REST_DELAY,
        "at rest the poll waits longer, and still before the minute asked for"
    );
}

#[test]
fn the_poll_rides_the_desks_own_wake_ups_at_rest_and_waits_no_longer_than_its_period() {
    let pump = Pump::new(None);
    let now = Instant::now();
    assert!(pump.take_due(now));
    let frame = now + Duration::from_millis(17);
    assert_eq!(
        pump.wake_at(Some(frame)),
        frame,
        "the desk's own frame first"
    );
    assert_eq!(
        pump.due(),
        now + MAX_DELAY,
        "a desk waking often keeps the poll"
    );
    let look = now + Duration::from_millis(80);
    assert_eq!(pump.wake_at(Some(look)), look, "the slow clock's look");
    assert!(
        !pump.take_due(look - Duration::from_millis(1)),
        "no poll before it"
    );
    assert!(pump.take_due(look), "the poll on the look's wake-up");
    let later = look + Duration::from_secs(5);
    assert_eq!(
        pump.wake_at(Some(later)),
        look + REST_DELAY,
        "never longer than the slow clock's period"
    );
    assert_eq!(
        pump.wake_at(None),
        look + REST_DELAY,
        "nothing on the clock"
    );
}
