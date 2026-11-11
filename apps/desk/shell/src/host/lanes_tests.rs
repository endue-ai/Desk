use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use super::Lanes;

const WAIT: Duration = Duration::from_secs(10);

/// What the jobs did, in the order they did it.
#[derive(Clone, Default)]
struct Log(Arc<Mutex<Vec<String>>>);

impl Log {
    fn push(&self, what: impl Into<String>) {
        self.0.lock().unwrap().push(what.into());
    }

    fn take(&self) -> Vec<String> {
        self.0.lock().unwrap().clone()
    }
}

/// Wait for `count` jobs to say they ended.
fn ended(done: &Receiver<()>, count: usize) {
    for n in 0..count {
        done.recv_timeout(WAIT)
            .unwrap_or_else(|_| panic!("only {n} of {count} jobs ended within {WAIT:?}"));
    }
}

/// Work that takes a while, longer for some jobs than for others.
fn work(i: usize) {
    let micros = [0, 1500, 200, 3000, 50, 800][i % 6];
    thread::sleep(Duration::from_micros(micros));
}

fn in_order(lanes: &Lanes<&'static str>, count: usize) -> Vec<String> {
    let log = Log::default();
    let (done, ended_rx) = mpsc::channel();
    for i in 0..count {
        let (log, done) = (log.clone(), done.clone());
        lanes.run("terminal", move || {
            work(i);
            log.push(i.to_string());
            let _ = done.send(());
        });
    }
    ended(&ended_rx, count);
    log.take()
}

#[test]
fn the_calls_of_one_lane_are_applied_in_the_order_sent() {
    let expected: Vec<String> = (0..100).map(|i| i.to_string()).collect();
    let letting_go = Lanes::letting_go("test-lane", Duration::from_secs(5));
    assert_eq!(in_order(&letting_go, 100), expected);
    assert_eq!(in_order(&Lanes::strict("test-lane"), 100), expected);
}

/// Lane `a` waits for what lane `b` does: it ends only if the two run side by side.
fn side_by_side(lanes: &Lanes<&'static str>) {
    let (told, heard) = mpsc::channel::<()>();
    let (done, ended_rx) = mpsc::channel();
    let log = Log::default();
    let (a_log, a_done) = (log.clone(), done.clone());
    lanes.run("a", move || {
        let heard = heard.recv_timeout(WAIT).is_ok();
        a_log.push(if heard {
            "a heard b"
        } else {
            "a never heard b"
        });
        let _ = a_done.send(());
    });
    lanes.run("b", move || {
        let _ = told.send(());
        let _ = done.send(());
    });
    ended(&ended_rx, 2);
    assert_eq!(log.take(), ["a heard b"]);
}

#[test]
fn the_calls_of_two_lanes_run_side_by_side() {
    side_by_side(&Lanes::letting_go("test-lane", Duration::from_secs(5)));
    side_by_side(&Lanes::strict("test-lane"));
}

#[test]
fn a_slow_call_does_not_hold_up_another_lane() {
    let lanes = Lanes::letting_go("test-lane", Duration::from_secs(5));
    let (release, slow) = mpsc::channel::<()>();
    lanes.run("files", move || {
        let _ = slow.recv_timeout(WAIT);
    });
    let (done, ended_rx) = mpsc::channel();
    let started = Instant::now();
    lanes.run("terminal", move || {
        let _ = done.send(());
    });
    ended(&ended_rx, 1);
    let took = started.elapsed();
    let _ = release.send(());
    assert!(
        took < Duration::from_secs(2),
        "the other lane waited {took:?}"
    );
}

/// A job that waits for the one after it in its own lane: the lane lets it go after the hold.
#[test]
fn a_call_waiting_for_a_later_one_of_its_lane_lets_it_run_after_the_hold() {
    let hold = Duration::from_millis(50);
    let lanes = Lanes::letting_go("test-lane", hold);
    let log = Log::default();
    let (answer, answered) = mpsc::channel::<()>();
    let (done, ended_rx) = mpsc::channel();
    let started = Instant::now();
    let (first_log, first_done) = (log.clone(), done.clone());
    lanes.run("permissions", move || {
        let heard = answered.recv_timeout(WAIT).is_ok();
        first_log.push(if heard {
            "request answered"
        } else {
            "request never answered"
        });
        let _ = first_done.send(());
    });
    let (second_log, second_done) = (log.clone(), done.clone());
    lanes.run("permissions", move || {
        second_log.push(format!("answer after {:?}", started.elapsed() >= hold));
        let _ = answer.send(());
        let _ = second_done.send(());
    });
    let third_log = log.clone();
    lanes.run("permissions", move || {
        third_log.push("next");
        let _ = done.send(());
    });
    ended(&ended_rx, 3);
    let log = log.take();
    assert_eq!(log[0], "answer after true", "{log:?}");
    assert!(log.contains(&"request answered".to_owned()), "{log:?}");
    let next = log.iter().position(|l| l == "next").unwrap();
    assert!(next > 0, "the call after the answer ran before it: {log:?}");
}

/// Queueing never waits for the lane's work, even while its job is held up: a page's thread can
/// send its calls whatever they do.
#[test]
fn queueing_a_call_never_waits() {
    let lanes = Lanes::letting_go("test-lane", Duration::from_secs(5));
    let (go, gate): (Sender<()>, Receiver<()>) = mpsc::channel();
    let (done, ended_rx) = mpsc::channel();
    let first_done = done.clone();
    lanes.run("terminal", move || {
        let _ = gate.recv_timeout(WAIT);
        let _ = first_done.send(());
    });
    let started = Instant::now();
    for _ in 0..1000 {
        let done = done.clone();
        lanes.run("terminal", move || {
            let _ = done.send(());
        });
    }
    let took = started.elapsed();
    let _ = go.send(());
    ended(&ended_rx, 1001);
    assert!(
        took < Duration::from_secs(2),
        "queueing 1000 calls took {took:?}"
    );
}

#[test]
fn a_job_that_panics_ends_alone_and_the_lane_goes_on() {
    for lanes in [
        Lanes::strict("test-lane"),
        Lanes::letting_go("test-lane", Duration::from_secs(5)),
    ] {
        let (done, ended_rx) = mpsc::channel();
        lanes.run("broken", || {
            panic!("a job's own failure (expected in this test)")
        });
        lanes.run("broken", move || {
            let _ = done.send(());
        });
        ended(&ended_rx, 1);
    }
}

#[test]
fn a_lane_with_nothing_left_to_do_is_gone() {
    let lanes = Lanes::letting_go("test-lane", Duration::from_secs(5));
    let (done, ended_rx) = mpsc::channel();
    for lane in ["a", "b", "c"] {
        let done = done.clone();
        lanes.run(lane, move || {
            let _ = done.send(());
        });
    }
    ended(&ended_rx, 3);
    let deadline = Instant::now() + WAIT;
    while lanes.busy() > 0 {
        assert!(Instant::now() < deadline, "{} lanes kept", lanes.busy());
        thread::sleep(Duration::from_millis(5));
    }
}
