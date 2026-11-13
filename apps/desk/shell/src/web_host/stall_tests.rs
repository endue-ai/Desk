use std::time::{Duration, Instant};

use super::{AFTER, AGAIN, Found, Verdict, Watch};

const SECOND: Duration = Duration::from_secs(1);

/// The page's asks while its frames do not come, `paints` painted: a first one, then one a second
/// on, the clock sending it `fed` begin frames after each (an ask gets the desk frames for 42 ms).
fn stalled_asks(
    watch: &mut Watch,
    t0: Instant,
    asks: u32,
    fed: u64,
    paints: u64,
) -> Vec<Option<Found>> {
    (0..asks)
        .map(|i| {
            let found = watch.asked(t0 + SECOND * i, SECOND * i, paints, true);
            for _ in 0..fed {
                watch.fed();
            }
            found
        })
        .collect()
}

#[test]
fn a_page_asking_again_after_its_begin_frames_for_three_seconds_is_stalled_and_loaded_again() {
    let t0 = Instant::now();
    let mut watch = Watch::default();
    watch.saw(7);
    let found = stalled_asks(&mut watch, t0, AFTER + 1, 3, 7);
    assert_eq!(
        &found[..AFTER as usize],
        &[None, None, None],
        "a first ask and two again"
    );
    assert_eq!(
        found[AFTER as usize],
        Some(Found {
            verdict: Verdict::Reload,
            waited: SECOND * AFTER,
            fed: 9
        }),
        "the third ask again after its begin frames: three seconds without a frame"
    );
    assert!(watch.stalled());
    assert_eq!(
        watch.asked(t0 + SECOND * 4, SECOND * 4, 7, true),
        None,
        "found once"
    );
}

#[test]
fn a_page_whose_frames_come_and_change_nothing_is_never_stalled() {
    // A requestAnimationFrame loop that draws nothing on a resting surface: each ask is a first one
    // (the frames it brought met the want), and nothing is painted.
    let t0 = Instant::now();
    let mut watch = Watch::default();
    for i in 0..200u32 {
        let at = t0 + Duration::from_millis(80) * i;
        assert_eq!(watch.asked(at, Duration::ZERO, 3, true), None);
        watch.fed();
        watch.fed();
    }
    assert!(!watch.stalled());
}

#[test]
fn asks_without_begin_frames_between_them_start_the_count_again() {
    // Hidden, asleep, or the clock held: the page asks a second on, and no begin frame went to it.
    let t0 = Instant::now();
    let mut watch = Watch::default();
    assert_eq!(stalled_asks(&mut watch, t0, 10, 0, 0), vec![None; 10]);
    // Shown again: the count starts at its first ask after begin frames.
    let found = stalled_asks(&mut watch, t0 + SECOND * 10, AFTER + 2, 2, 0);
    assert_eq!(found.iter().filter(|f| f.is_some()).count(), 1);
    assert_eq!(
        found[AFTER as usize].map(|f| f.verdict),
        Some(Verdict::Reload)
    );
}

#[test]
fn a_paint_ends_the_count_and_the_stall() {
    let t0 = Instant::now();
    let mut watch = Watch::default();
    // A first ask and two again: one short of a stall.
    stalled_asks(&mut watch, t0, AFTER, 3, 7);
    watch.saw(8);
    let next = watch.asked(t0 + SECOND * AFTER, SECOND * AFTER, 8, true);
    assert_eq!(next, None, "it painted: the count began again");
    stalled_asks(&mut watch, t0, AFTER + 1, 3, 8);
    assert!(watch.stalled());
    watch.saw(9);
    assert!(!watch.stalled(), "it paints again");
}

#[test]
fn the_desks_page_is_reported_once_and_a_second_load_waits_its_time() {
    let t0 = Instant::now();
    let mut page = Watch::default();
    let found: Vec<Option<Found>> = (0..30u32)
        .map(|i| {
            let found = page.asked(t0 + SECOND * i, SECOND * i, 0, false);
            page.fed();
            found
        })
        .collect();
    let verdicts: Vec<Verdict> = found.iter().flatten().map(|f| f.verdict).collect();
    assert_eq!(
        verdicts,
        [Verdict::Report],
        "reported once, never loaded again"
    );

    let mut surface = Watch::default();
    let found = stalled_asks(&mut surface, t0, AFTER + 1, 3, 0);
    assert_eq!(
        found[AFTER as usize].map(|f| f.verdict),
        Some(Verdict::Reload)
    );
    // Loaded again, it stalls again at once: said once, loaded again only `AGAIN` after the first.
    surface.restart();
    let found = stalled_asks(&mut surface, t0 + SECOND * (AFTER + 1), 12, 3, 0);
    let at: Vec<(u32, Verdict)> = (found.iter().enumerate())
        .filter_map(|(i, f)| f.map(|f| (i as u32, f.verdict)))
        .collect();
    let again = AGAIN.as_secs() as u32 - 1;
    assert_eq!(at, [(AFTER, Verdict::Report), (again, Verdict::Reload)]);
}

#[test]
fn the_asks_again_short_of_a_stall_are_counted_so_its_browser_hears_its_screen_first() {
    // `clock.rs` tells a page's browser its screen again on each of these (#248, ADR 0210).
    let t0 = Instant::now();
    let mut watch = Watch::default();
    watch.saw(7);
    let repeats: Vec<u32> = (0..AFTER)
        .map(|i| {
            watch.asked(t0 + SECOND * i, SECOND * i, 7, true);
            (0..3).for_each(|_| watch.fed());
            watch.repeats()
        })
        .collect();
    assert_eq!(repeats, [0, 1, 2], "a first ask, then two again");
    watch.saw(8);
    assert_eq!(watch.repeats(), 0, "a paint starts the count over");
}
