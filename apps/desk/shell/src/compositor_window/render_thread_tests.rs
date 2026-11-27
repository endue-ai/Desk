//! The render thread (#249, ADR 0235): it draws the scene the main thread hands it on the display's
//! clock, whatever the main thread does meanwhile.

use std::time::{Duration, Instant};

use desk_compositor::{Compositor, Scene};

use super::{Handed, RenderThread, Target};
use crate::compositor_window::clock::Behind;
use crate::compositor_window::composed::Shared;
use crate::frame_trace::Timed;
use crate::web_host::frames::interval;

fn handed(n: u64, slot: Instant) -> Handed {
    Handed {
        scene: Some(Scene::new(320, 200)),
        slot,
        timed: Timed::begin(|| true),
        n,
    }
}

#[test]
fn a_scene_handed_to_the_render_thread_is_presented_while_the_main_thread_is_busy() {
    let test = "a_scene_handed_to_the_render_thread_is_presented_while_the_main_thread_is_busy";
    let Ok(gpu) = desk_compositor::headless::headless_device() else {
        eprintln!("{test}: skipped, no GPU device");
        return;
    };
    let format = wgpu::TextureFormat::Bgra8Unorm;
    let shared = Shared::new(Compositor::new(&gpu.device, &gpu.queue, format));
    let every = interval(60);
    // Off screen, rendering each frame as the gate's trace has it rendered.
    let render = RenderThread::start(Target::Unseen { render: true }, shared, every);
    let slot = Instant::now();
    render.hand(handed(1, slot));
    // The main thread is busy for 20 ms right after handing its scene.
    std::thread::sleep(Duration::from_millis(20));
    let state = render.state();
    assert_eq!(state.drawn, 1, "drawn while the main thread was busy");
    assert_eq!(state.last.map(|(n, _)| n), Some(1));
    // Two scenes for the next slot before its tick: the later replaces the one not yet drawn.
    let next = Instant::now() + every;
    render.hand(handed(2, next));
    render.hand(handed(3, next));
    std::thread::sleep(every * 3);
    let state = render.state();
    assert_eq!(state.drawn, 2, "one frame for the slot");
    let (n, at) = state.last.expect("a frame drawn");
    assert_eq!(n, 3, "the later scene");
    assert!(at >= next, "not before its slot");
    // A frame for the next slot handed before the one waiting was drawn waits behind it: a frame
    // this thread is late for is drawn, not dropped.
    let late = Instant::now();
    render.hand(handed(4, late));
    render.hand(handed(5, late + every));
    std::thread::sleep(every * 4);
    let state = render.state();
    assert_eq!(state.drawn, 4, "both drawn");
    assert_eq!(state.last.map(|(n, _)| n), Some(5));
}

#[test]
fn a_restarted_beat_draws_an_overdue_frame_before_rebuilding_its_margin() {
    for rate in [60, 120] {
        let every = interval(rate);
        let start = Instant::now();
        let mut behind = Behind::default();
        let mut last = start;
        for n in 0..12 {
            let slot = start + every * n;
            last = behind.draw_at(slot, slot, every);
        }
        // The main thread missed a beat and handed a fresh slot after the next draw was due.
        let handed = last + every + every / 3;
        assert_eq!(behind.draw_at(handed, handed, every), handed, "{rate} Hz");
        let next = handed + every;
        assert_eq!(
            behind.draw_at(next, next, every),
            next + every / 8,
            "{rate} Hz: build the margin back one step at a time"
        );
    }
}

#[test]
fn frames_in_a_row_are_drawn_up_to_most_of_a_display_interval_behind_their_slot() {
    for rate in [60, 120] {
        let every = interval(rate);
        let mut behind = Behind::default();
        let start = Instant::now();
        // From rest the first frame is drawn at once: a key's paint waits for no tick.
        assert_eq!(behind.draw_at(start, start, every), start, "{rate} Hz");
        // In a row, each is drawn a little further behind its slot, a frame a step, up to most of
        // an interval: the slack a late main thread has before a frame is late.
        let mut last = start;
        for k in 1..20u32 {
            let slot = start + every * k;
            let at = behind.draw_at(slot, slot, every);
            assert!(at - last >= every, "{rate} Hz: never two in an interval");
            assert!(at - last <= every + every / 8, "{rate} Hz: a gentle step");
            last = at;
        }
        let slot = start + every * 20;
        assert_eq!(
            behind.draw_at(slot, slot, every),
            slot + Behind::most(every),
            "{rate} Hz"
        );
        // A main thread late by less than that: drawn on time all the same.
        let slot = start + every * 21;
        let late = slot + every / 2;
        assert_eq!(
            behind.draw_at(slot, late, every),
            slot + Behind::most(every)
        );
        // Later still: drawn at once.
        let slot = start + every * 22;
        let later = slot + every - every / 8;
        assert_eq!(behind.draw_at(slot, later, every), later, "{rate} Hz");
        // After a rest: at once again.
        let rested = later + every * 10;
        assert_eq!(behind.draw_at(rested, rested, every), rested, "{rate} Hz");
    }
}
