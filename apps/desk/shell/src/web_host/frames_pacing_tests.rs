use super::Pacing;
use crate::web_host::frames::{
    ASKED_FOR, Clock, FRAME, IDLE, LONG_IDLE, PROMPT, PROMPT_AFTER, PROMPT_AFTER_REST, PROMPT_FOR,
    RATE,
};
use std::time::{Duration, Instant};

/// Which of desk `frames` a surface that painted `paints` frames takes, as `x` and `.`.
fn taken(pacing: &mut Pacing, now: Instant, frames: std::ops::Range<u64>, paints: u64) -> String {
    frames
        .map(|k| {
            if pacing.due(now, Some(k), paints) {
                'x'
            } else {
                '.'
            }
        })
        .collect()
}

/// Looks at every desk frame of the second after `from` (frames `k + 1` on) with `paints` painted,
/// as the desk does while a surface takes every frame.
fn a_second_of_frames(pacing: &mut Pacing, from: Instant, k: u64, paints: u64) {
    for j in 1..RATE {
        pacing.due(from + FRAME * j, Some(k + u64::from(j)), paints);
    }
}

fn ms(at: Instant, ms: f64) -> Instant {
    at + Duration::from_secs_f64(ms / 1000.0)
}

#[test]
fn a_surfaces_pace_takes_every_desk_frame_or_skips_evenly() {
    let now = Instant::now();
    let pattern = |pace: u32, n: u64| taken(&mut Pacing::new(pace), now, 0..n, 0);
    assert_eq!(pattern(60, 6), "xxxxxx");
    assert_eq!(pattern(240, 3), "xxx", "never more than the desk's frames");
    assert_eq!(pattern(30, 6), "x.x.x.");
    assert_eq!(pattern(10, 13), "x.....x.....x");
    assert_eq!(pattern(45, 8), "x.xxx.xx", "three in four");
    assert_eq!(
        pattern(0, 3),
        "x..",
        "at least one a second, the first at once"
    );
    let mut pacing = Pacing::new(60);
    assert!(!pacing.due(now, None, 0), "only desk frames are paced");
    assert_eq!(taken(&mut pacing, now, 0..3, 0), "xxx");
    pacing.set_pace(30);
    assert_eq!(
        taken(&mut pacing, now, 3..7, 0),
        "x.x.",
        "a new pace from the next frame"
    );
    let mut late = Pacing::new(30);
    assert_eq!(
        taken(&mut late, now, 5..9, 0),
        "x.x.",
        "its first desk frame is its own"
    );
}

#[test]
fn a_long_idle_surface_rests_until_it_hears_something_paints_or_its_page_asks() {
    let t0 = Instant::now();
    let (mut a, mut b) = (Pacing::new(60), Pacing::new(60));
    assert!(a.due(t0, Some(0), 1), "a's page painted");
    assert!(b.due(t0, Some(3), 1), "b's first frame is its own");
    a_second_of_frames(&mut a, t0, 0, 1);
    a_second_of_frames(&mut b, t0, 3, 1);
    let rest = t0 + LONG_IDLE;
    assert!(a.long_idle(rest) && b.long_idle(rest));
    assert_eq!(
        taken(&mut a, rest, 60..73, 1),
        ".............",
        "no frame at rest"
    );
    assert_eq!(taken(&mut b, rest, 60..73, 1), ".............");
    // Input or a message puts it back on every frame.
    a.heard(rest);
    assert!(!a.long_idle(rest));
    assert_eq!(taken(&mut a, rest, 73..76, 1), "xxx");
    // Its page asks: the desk frames within ASKED_FOR, then none again, unless they brought a paint.
    let asked = rest + FRAME / 2;
    b.ask(asked);
    let looks = [0.0, 16.7, 33.4, 50.1].map(|t| ms(asked, t));
    let got: Vec<bool> = looks
        .iter()
        .zip(80u64..)
        .map(|(at, k)| b.due(*at, Some(k), 1))
        .collect();
    assert_eq!(
        got,
        [true, true, true, false],
        "{ASKED_FOR:?} of desk frames"
    );
    assert!(
        b.long_idle(looks[3]),
        "nothing came of them: it rests again"
    );
    b.ask(looks[3]);
    assert!(b.due(looks[3], Some(84), 1));
    let painted = looks[3] + FRAME;
    assert!(b.due(painted, Some(85), 2), "a paint came");
    assert!(!b.long_idle(painted + LONG_IDLE / 2));
    // A lone paint: the ask's last frame, then the slow frames for a second, not every frame.
    let after: String = (1..=60u32)
        .map(|j| b.due(painted + FRAME * j, Some(85 + u64::from(j)), 2))
        .map(|due| if due { 'x' } else { '.' })
        .collect();
    assert_eq!(after, format!("x....x{}......", ".....x".repeat(8)));
}

#[test]
fn a_page_that_has_not_painted_since_it_loaded_keeps_its_frames_while_it_rests() {
    let t0 = Instant::now();
    let mut slow = Pacing::new(60);
    // A start-up script holds the page's thread: no paint, no ask, for longer than LONG_IDLE.
    assert!(slow.due(t0, Some(0), 0));
    let late = t0 + LONG_IDLE * 3;
    assert!(slow.long_idle(late), "it rests");
    assert_eq!(
        taken(&mut slow, late, 180..183, 0),
        "xxx",
        "but counts as asking: it keeps its desk frames"
    );
    // Its first paint comes; once idle after it, it rests without frames.
    assert!(slow.due(late, Some(183), 1));
    a_second_of_frames(&mut slow, late, 183, 1);
    let rest = late + LONG_IDLE;
    assert!(slow.long_idle(rest));
    assert_eq!(taken(&mut slow, rest, 240..243, 1), "...");
    // A reload in place (or a restart) starts over: frames until the new page paints.
    slow.loading(rest);
    let again = rest + LONG_IDLE * 2;
    assert_eq!(
        taken(&mut slow, again, 300..303, 1),
        "xxx",
        "a new page, not painted yet"
    );
}

#[test]
fn a_desk_at_rest_has_nothing_to_look_at_until_a_page_asks_or_a_press_comes() {
    let t0 = Instant::now();
    let mut clock = Clock::default();
    let mut pacing = Pacing::new(60);
    assert!(pacing.due(t0, clock.frame(t0), 1));
    assert_eq!(
        pacing.next(&clock, t0),
        Some(t0 + FRAME),
        "awake: every frame"
    );
    a_second_of_frames(&mut pacing, t0, 0, 1);
    let rest = t0 + LONG_IDLE;
    let k = clock.frame(rest);
    assert!(!pacing.due(rest, k, 1));
    assert_eq!(pacing.next(&clock, rest), None, "no look at rest");
    pacing.ask(rest);
    assert_eq!(
        pacing.next(&clock, rest),
        clock.next(),
        "its page asked: the next desk frame"
    );
    let after = rest + ASKED_FOR + FRAME;
    assert_eq!(
        pacing.next(&clock, after),
        None,
        "and none once the ask is over"
    );
    let k = clock.frame(after);
    assert!(!pacing.due(after, k, 1));
    pacing.press(after, 1);
    assert_eq!(
        pacing.next(&clock, after),
        clock.next(),
        "a press wakes it: the next desk frame"
    );
    let first = after + PROMPT_AFTER_REST;
    assert!(
        !pacing.due(first - PROMPT, None, 1),
        "a surface at rest has no prompt until {PROMPT_AFTER_REST:?} after the press (ADR 0210)"
    );
    assert!(pacing.due(first, None, 1), "its first prompt");
}

#[test]
fn a_press_on_an_idle_surface_brings_begin_frames_soon_after_until_it_paints() {
    let mut pacing = Pacing::new(1);
    let t0 = Instant::now();
    assert!(pacing.due(t0, Some(0), 0), "its first frame");
    assert!(!pacing.due(t0 + FRAME, Some(1), 0), "a second's pace");
    let pressed = t0 + FRAME;
    pacing.press(pressed, 0);
    let clock = Clock::default();
    let first = pressed + PROMPT_AFTER;
    assert_eq!(
        pacing.next(&clock, pressed),
        Some(first),
        "{PROMPT_AFTER:?} after the press (ADR 0210)"
    );
    assert!(!pacing.due(pressed, None, 0), "not at the press");
    let looks = [0.0, 0.5, 1.0, 2.0, 3.0];
    let got: Vec<bool> = looks
        .iter()
        .map(|t| pacing.due(ms(first, *t), None, 0))
        .collect();
    assert_eq!(got, [true, false, true, true, true], "every {PROMPT:?}");
    assert!(!pacing.due(ms(first, 3.5), None, 0));
    assert!(pacing.due(ms(first, 9.0), None, 0), "a late look takes one");
    assert!(
        !pacing.due(ms(first, 9.1), None, 0),
        "not every one it missed"
    );
    assert!(
        !pacing.due(ms(first, 10.0), None, 1),
        "its paint came: no more"
    );
    assert_eq!(pacing.next(&clock, ms(first, 10.0)), None);

    let mut unanswered = Pacing::new(1);
    unanswered.due(t0, Some(0), 0);
    unanswered.press(pressed, 0);
    let sent = (0..60)
        .filter(|t| unanswered.due(ms(pressed, f64::from(*t)), None, 0))
        .count();
    assert_eq!(
        sent, 32,
        "from {PROMPT_AFTER:?} to {PROMPT_FOR:?} after the press when no paint comes"
    );
}

#[test]
fn a_press_on_a_surface_that_paints_already_waits_for_its_desk_frames() {
    let mut pacing = Pacing::new(60);
    let t0 = Instant::now();
    assert!(pacing.due(t0, Some(0), 1), "it painted");
    pacing.press(t0 + FRAME, 2);
    let clock = Clock::default();
    assert_eq!(
        pacing.next(&clock, t0 + FRAME),
        None,
        "it takes every desk frame"
    );
    assert!(pacing.due(t0 + FRAME, Some(1), 2));
    let idle = t0 + FRAME + IDLE;
    pacing.press(idle, 2);
    assert_eq!(
        pacing.next(&clock, idle),
        Some(idle + PROMPT_AFTER),
        "idle again after {IDLE:?}"
    );
}

#[test]
fn the_clock_notes_when_a_surface_painted() {
    let t0 = Instant::now();
    let mut pacing = Pacing::new(60);
    pacing.due(t0, Some(0), 0);
    assert_eq!(pacing.painted(), None, "no paint yet");
    pacing.due(t0 + FRAME, Some(1), 1);
    assert_eq!(pacing.painted(), Some(t0 + FRAME));
    pacing.due(t0 + FRAME * 2, Some(2), 1);
    assert_eq!(
        pacing.painted(),
        Some(t0 + FRAME),
        "only when its count moves"
    );
}
