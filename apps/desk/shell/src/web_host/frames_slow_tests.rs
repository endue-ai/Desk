//! The slow frames (#163): a lone paint, as a caret's blink is, takes them and not every desk
//! frame; an animation, a video or a GIF keeps every frame. Lone paints on a rhythm take two slow
//! frames each once it shows (R1, `frames_rhythm.rs`).

use super::Pacing;
use crate::web_host::frames::{Clock, FRAME, LONG_IDLE, PAINTING, RATE, SLOW};
use std::time::{Duration, Instant};

/// What a page that changes on its own did on the clock: the begin frames and the paints in each
/// second, and how long each change waited for the frame that painted it (ms), from `from` s on.
struct Run {
    sent: Vec<u32>,
    painted: Vec<u32>,
    waits: Vec<f64>,
    pacing: Pacing,
    t0: Instant,
}

impl Run {
    /// `secs` s after the run's start.
    fn at(&self, secs: f64) -> Instant {
        self.t0 + Duration::from_secs_f64(secs)
    }

    fn rate(counts: &[u32], from: usize) -> f64 {
        let counted = &counts[from..];
        f64::from(counted.iter().sum::<u32>()) / counted.len() as f64
    }

    fn worst(&self) -> f64 {
        self.waits.iter().copied().fold(0.0, f64::max)
    }

    fn spread(&self) -> f64 {
        self.worst() - self.waits.iter().copied().fold(f64::MAX, f64::min)
    }
}

/// A page painting at most `pace` frames a second whose changes come at `changes` (ms), each
/// painted by the first begin frame `lag` ms or more after it and seen at the next look, looked at
/// every desk frame for `secs` s and hearing nothing after the first look.
fn paced(pace: u32, changes: &[f64], lag: f64, secs: usize, from: usize) -> Run {
    let (t0, mut pacing) = (Instant::now(), Pacing::new(pace));
    let (mut paints, mut pending, mut next) = (0, None, changes.iter().copied().peekable());
    let (mut sent, mut painted, mut waits) = (vec![0; secs], vec![0; secs], vec![]);
    for k in 0..RATE as usize * secs {
        let t = k as f64 * FRAME.as_secs_f64() * 1000.0;
        while next.peek().is_some_and(|at| t >= *at + lag) {
            pending = pending.or(next.next());
        }
        let due = pacing.due(
            t0 + FRAME * u32::try_from(k).unwrap(),
            Some(k as u64),
            paints,
        );
        let second = k / RATE as usize;
        if let Some(since) = pending.filter(|_| due) {
            (paints, pending) = (paints + 1, None);
            painted[second] += 1;
            if second >= from {
                waits.push(t - since);
            }
        }
        sent[second] += u32::from(due);
    }
    Run {
        sent,
        painted,
        waits,
        pacing,
        t0,
    }
}

/// The same at the display's pace.
fn run(changes: &[f64], lag: f64, secs: usize, from: usize) -> Run {
    paced(RATE, changes, lag, secs, from)
}

/// Changes every `period` ms from `phase` on, up to `until` ms.
fn every(period: f64, phase: f64, until: f64) -> Vec<f64> {
    (0..)
        .map(|n| phase + f64::from(n) * period)
        .take_while(|at| *at < until)
        .collect()
}

#[test]
fn a_blinking_caret_keeps_its_rhythm_on_the_slow_frames_whenever_the_desk_looks() {
    // CEF's poll and work wake the desk at times of their own, up to 9 ms late, and the clock's
    // frames start again from a late look (`Clock::frame`). A blink, on its page's own timer, must
    // still meet the slow frames, and then the rhythm's, at the same moment each time: on frames
    // counted by number it waited from 0 to 100 ms, blinks 393 to 610 ms apart.
    let t0 = Instant::now();
    let (mut clock, mut pacing, mut seed) = (Clock::default(), Pacing::new(60), 7u32);
    let mut late = || {
        seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
        Duration::from_micros(u64::from(seed >> 8) % 9_000)
    };
    let (mut now, mut blink, mut poll) = (t0, t0 + FRAME / 3, t0 + FRAME * 2);
    let (mut paints, mut pending, mut compose, mut waits, mut sent) = (0, None, None, vec![], 0);
    while now < t0 + LONG_IDLE * 8 {
        while blink <= now {
            pending = pending.or(Some(blink));
            blink += LONG_IDLE / 2;
        }
        let due = pacing.due(now, clock.frame(now), paints);
        let counted = now >= t0 + LONG_IDLE * 3;
        sent += u32::from(due && counted);
        if let Some(since) = pending.filter(|_| due) {
            (paints, pending, compose) = (paints + 1, None, Some(now + FRAME));
            waits.extend(counted.then(|| now - since));
        }
        if poll <= now {
            poll += Duration::from_millis(100);
        }
        let next = [pacing.next(&clock, now), Some(poll), compose.take()];
        now = next.into_iter().flatten().min().unwrap().max(now) + late();
    }
    let (fast, slow) = (waits.iter().min().unwrap(), waits.iter().max().unwrap());
    assert_eq!(waits.len(), 10, "every blink painted");
    assert!(
        slow.saturating_sub(*fast) < Duration::from_millis(10),
        "{waits:?}"
    );
    let period = pacing.rhythm().expect("the rhythm holds");
    assert!(period.abs_diff(LONG_IDLE / 2) < Duration::from_millis(1));
    assert!(sent <= 21, "two begin frames a blink: {sent} in 5 s");
}

#[test]
fn a_blinking_caret_takes_ten_slow_frames_a_second_then_two_a_blink_once_its_rhythm_shows() {
    // A caret blinks every half second: a lone paint each time, and nothing heard (#163). Ten slow
    // frames a second kept a fresh desk's process at 11 to 15 % of a core (R1).
    let run = run(&every(500.0, 7.0, 10_000.0), 2.0, 10, 3);
    assert!(
        run.sent[1] >= SLOW - 1,
        "learning it on the slow frames: {:?}",
        run.sent
    );
    assert_eq!(
        Run::rate(&run.sent, 3),
        4.0,
        "then two a blink: {:?}",
        run.sent
    );
    assert_eq!(Run::rate(&run.painted, 1), 2.0, "every blink still shows");
    assert!(run.spread() < 1.0, "evenly: {:?}", run.waits);
    assert!(
        run.worst() < 100.0 + 2.0,
        "within a slow frame: {} ms",
        run.worst()
    );
    // xterm's canvas renderers blink every 600 ms.
    let xterm = paced(RATE, &every(600.0, 7.0, 10_000.0), 2.0, 10, 4);
    let period = xterm.pacing.rhythm().expect("its rhythm");
    assert!(period.abs_diff(Duration::from_millis(600)) < Duration::from_millis(1));
    assert_eq!(
        Run::rate(&xterm.sent, 4),
        2.0 * Run::rate(&xterm.painted, 4)
    );
    // A pace slower than the slow frames keeps its own: 500 ms meets 200 ms apart unevenly.
    let slow = paced(5, &every(500.0, 7.0, 8_000.0), 0.0, 8, 2);
    assert_eq!(Run::rate(&slow.sent, 2), 5.0);
    assert_eq!(Run::rate(&slow.painted, 2), 2.0);
}

#[test]
fn a_blink_that_moves_finds_the_slow_frames_from_the_rhythms_frame_on_and_the_rhythm_again() {
    // The blink starts again 230 ms on at 5 s, nothing heard: the rhythm's frame brings no paint.
    let mut changes = every(500.0, 7.0, 5_000.0);
    changes.extend(every(500.0, 5_230.0, 10_000.0));
    let run = run(&changes, 2.0, 10, 5);
    assert_eq!(Run::rate(&run.painted, 1), 2.0, "every blink painted");
    assert!(
        run.worst() < 100.0 + 2.0,
        "within a slow frame: {:?}",
        run.waits
    );
    assert_eq!(
        Run::rate(&run.sent, 8),
        4.0,
        "the rhythm again: {:?}",
        run.sent
    );
    assert!(run.sent[5] > 4, "the slow frames meanwhile: {:?}", run.sent);
}

#[test]
fn a_blink_whose_period_the_slow_frames_cannot_measure_keeps_every_blink_within_a_slow_frame() {
    // 530 and 580 ms meet frames 100 ms apart 500 and 600 ms apart, so the gap the rhythm holds is
    // a little short or a little long: no blink waits more than a slow frame, none merges with the
    // next.
    for period in [530.0, 580.0] {
        let changes = every(period, 7.0, 20_000.0);
        let run = run(&changes, 2.0, 20, 2);
        let shown = changes.iter().filter(|at| **at >= 2000.0).count();
        assert_eq!(run.waits.len(), shown, "{period} ms: every blink painted");
        assert!(run.worst() < 100.0 + 2.0, "{period} ms: {:?}", run.waits);
        let (sent, painted) = (Run::rate(&run.sent, 4), Run::rate(&run.painted, 4));
        assert!(
            sent < 3.0 * painted,
            "{period} ms: {sent} begin frames for {painted} paints"
        );
    }
}

#[test]
fn a_blink_that_stops_rests_its_surface_a_second_and_ten_slow_frames_later() {
    let run = run(&every(500.0, 7.0, 5_000.0), 2.0, 8, 3);
    assert_eq!(&run.painted[3..], [2, 2, 0, 0, 0], "blinks until 5 s");
    assert!(
        run.sent[5] + run.sent[6] <= SLOW,
        "the rhythm's two, then the slow frames: {:?}",
        run.sent
    );
    assert_eq!(run.sent[7], 0, "no begin frame at rest");
    assert!(run.pacing.long_idle(run.at(7.9)), "it rests");
}

#[test]
fn lone_paints_without_a_rhythm_keep_the_slow_frames() {
    // The page's first paints, then gaps of 500, 800, 300, 800 and 300 ms: no three lone paints the
    // same time apart.
    let changes = [7.0, 500.0, 1350.0, 1850.0, 2650.0, 2950.0, 3750.0, 4050.0];
    let run = run(&changes, 2.0, 5, 1);
    assert_eq!(
        run.waits.len(),
        6,
        "every change painted: {:?}",
        run.painted
    );
    assert!(
        run.worst() < 100.0 + 2.0,
        "within a slow frame: {:?}",
        run.waits
    );
    assert_eq!(run.pacing.rhythm(), None);
    assert_eq!(run.sent[2], SLOW, "{:?}", run.sent);
}

#[test]
fn a_desk_that_could_not_look_for_a_while_still_owes_a_lone_paint_its_slow_frames() {
    // The event loop held for 3 s (CEF's work, a long task) sent none of the slow frames after a
    // blink, so the next blink still gets them: by the clock alone it rested, and the caret froze.
    let t0 = Instant::now();
    let mut pacing = Pacing::new(60);
    assert!(pacing.due(t0, Some(0), 1), "its first paint");
    let blink = t0 + LONG_IDLE + FRAME;
    assert!(
        !pacing.due(blink, Some(61), 2),
        "a lone paint: the slow frames"
    );
    let held = blink + LONG_IDLE * 3;
    assert!(!pacing.long_idle(held), "none of its slow frames went out");
    let mut at = held;
    for n in 0..SLOW {
        assert!(pacing.due(at, None, 2), "slow frame {n}");
        at += FRAME * 6;
    }
    assert!(
        pacing.long_idle(at),
        "{SLOW} frames and a second without a paint: it rests"
    );
}

#[test]
fn an_animation_a_video_and_a_slow_gif_keep_every_desk_frame() {
    let frame = FRAME.as_secs_f64() * 1000.0;
    for (what, period) in [
        ("60 fps", frame),
        ("a video", 1000.0 / 24.0),
        ("a gif", 125.0),
    ] {
        let run = run(&every(period, 3.0, 6_000.0), 0.0, 6, 2);
        assert_eq!(Run::rate(&run.sent, 2), 60.0, "{what}: every desk frame");
        let paints = Run::rate(&run.painted, 2);
        assert!(
            (paints - 1000.0 / period).abs() < 1.0,
            "{what}: {paints} a second"
        );
        assert!(
            run.worst() < frame,
            "{what}: a change waited {} ms",
            run.worst()
        );
        assert_eq!(run.pacing.rhythm(), None, "{what}: no lone paints");
    }
}

#[test]
fn after_its_last_paint_a_surface_takes_every_frame_briefly_then_the_slow_ones_then_none() {
    let t0 = Instant::now();
    let (mut clock, mut pacing) = (Clock::default(), Pacing::new(60));
    let at = |k: u64| t0 + FRAME * u32::try_from(k).unwrap();
    // Shown and painted at frame 0; an animation paints at every frame from 120 to 140, then ends.
    let mut got = String::new();
    for k in 0..240 {
        let frame = clock.frame(at(k));
        let due = pacing.due(at(k), frame, k.clamp(119, 140) - 118);
        if k >= 140 {
            got.push(if due { 'x' } else { '.' });
        }
        if k == 157 {
            assert_eq!(
                pacing.next(&clock, at(k)),
                clock.at(161),
                "the next slow frame"
            );
        }
    }
    // PAINTING is 15 desk frames from the last paint, LONG_IDLE 60; the slow frames come every
    // sixth desk frame from the first frame on them, 155.
    assert_eq!(PAINTING.as_millis(), 250);
    let slow: String = (155..200)
        .map(|k| if k > 155 && k % 6 == 5 { 'x' } else { '.' })
        .collect();
    assert_eq!(got, format!("{}{slow}{}", "x".repeat(15), ".".repeat(40)));
    assert!(pacing.long_idle(at(200)));
    assert_eq!(pacing.next(&clock, at(239)), None, "it rests");
}
