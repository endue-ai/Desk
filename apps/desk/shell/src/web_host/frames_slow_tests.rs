//! The slow frames (#163): a lone paint, as a caret's blink is, takes them and not every desk
//! frame; an animation, a video or a GIF keeps every frame.

use super::Pacing;
use crate::web_host::frames::{Clock, FRAME, LONG_IDLE, PAINTING, RATE, SLOW};
use std::time::{Duration, Instant};

/// A page that changes on its own every `period` ms from `phase` on (a caret's blink, a video), each
/// change painted by the first begin frame at or after it and seen at the next look, looked at every
/// desk frame for `secs` s and hearing nothing after the first look: over the last `secs - 2` s, the
/// begin frames and the paints a second, and the longest a change waited for its begin frame (ms).
fn changes_on_its_own(pacing: &mut Pacing, period: f64, phase: f64, secs: u64) -> (f64, f64, f64) {
    let t0 = Instant::now();
    let (mut paints, mut pending, mut next) = (0, None, phase);
    let (mut sent, mut painted, mut worst) = (0u32, 0u32, 0f64);
    for k in 0..u64::from(RATE) * secs {
        let t = k as f64 * FRAME.as_secs_f64() * 1000.0;
        if t >= next {
            pending = pending.or(Some(next));
            next += period;
        }
        let due = pacing.due(t0 + FRAME * u32::try_from(k).unwrap(), Some(k), paints);
        let counted = k >= u64::from(RATE) * 2;
        if let Some(since) = pending.filter(|_| due) {
            (paints, pending) = (paints + 1, None);
            if counted {
                painted += 1;
                worst = worst.max(t - since);
            }
        }
        sent += u32::from(due && counted);
    }
    let seconds = (secs - 2) as f64;
    (
        f64::from(sent) / seconds,
        f64::from(painted) / seconds,
        worst,
    )
}

#[test]
fn a_blinking_caret_keeps_its_rhythm_on_the_slow_frames_whenever_the_desk_looks() {
    // CEF's poll and work wake the desk at times of their own, up to 9 ms late, and the clock's
    // frames start again from a late look (`Clock::frame`). A blink, on its page's own timer, must
    // still meet the slow frames at the same moment each time: on frames counted by number it waited
    // from 0 to 100 ms, blinks 393 to 610 ms apart.
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
        let counted = now >= t0 + LONG_IDLE * 2;
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
    assert_eq!(waits.len(), 12, "every blink painted");
    assert!(
        slow.saturating_sub(*fast) < Duration::from_millis(10),
        "{waits:?}"
    );
    assert!(sent <= 61, "{sent} begin frames in 6 s");
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
fn a_blinking_caret_takes_ten_slow_frames_a_second_not_every_desk_frame() {
    // A caret blinks every half second: a lone paint each time, and nothing heard (#163).
    let (sent, paints, worst) = changes_on_its_own(&mut Pacing::new(60), 500.0, 7.0, 8);
    assert_eq!(paints, 2.0, "every blink still shows");
    assert_eq!(
        sent,
        f64::from(SLOW),
        "begin frames a second for {paints} paints"
    );
    assert!(
        worst < 1000.0 / f64::from(SLOW),
        "within a slow frame: {worst} ms"
    );
    // A pace slower than the slow frames keeps its own.
    let (sent, paints, _) = changes_on_its_own(&mut Pacing::new(5), 500.0, 7.0, 8);
    assert_eq!((sent, paints), (5.0, 2.0));
}

#[test]
fn an_animation_a_video_and_a_slow_gif_keep_every_desk_frame() {
    let frame = FRAME.as_secs_f64() * 1000.0;
    for (what, period) in [
        ("60 fps", frame),
        ("a video", 1000.0 / 24.0),
        ("a gif", 125.0),
    ] {
        let (sent, paints, worst) = changes_on_its_own(&mut Pacing::new(60), period, 3.0, 6);
        assert_eq!(sent, 60.0, "{what}: every desk frame");
        assert!(
            (paints - 1000.0 / period).abs() < 1.0,
            "{what}: {paints} a second"
        );
        assert!(worst < frame, "{what}: a change waited {worst} ms");
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
