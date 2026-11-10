//! Input through the web host (#58, on #56's path): a press at a surface's middle as the
//! compositor's router sends it (`pointer.down` and `pointer.up` in the surface's own logical
//! pixels), and the `input` scenario: from the press to the surface's next paint reaching the
//! compositor, and to the desk's first composed frame holding it, twenty times beside two animating
//! surfaces. `tests/budgets.rs` judges the frame against RT-16's 16 ms; `tests/isolation.rs` presses
//! a surface whose neighbour's renderer was killed.

use std::time::Duration;

use serde_json::{Value, json};

use super::Probe;
use super::desk_loop::DeskLoop;

const SIZE: (u32, u32) = (320, 200);
const START: Duration = Duration::from_secs(20);
const TRIES: usize = 20;
/// The longest a press may wait for its paint before the try counts as lost.
const LOST: Duration = Duration::from_secs(1);

/// Press the middle of `surface` with the left button.
pub fn press(probe: &Probe, surface: &str) {
    let (x, y) = (f64::from(SIZE.0) / 2.0, f64::from(SIZE.1) / 2.0);
    for kind in ["pointer.down", "pointer.up"] {
        probe.send(
            json!({ "type": kind, "surface": surface, "x": x, "y": y, "button": "left",
            "buttons": [], "clicks": 1, "modifiers": [] }),
        );
    }
}

/// The presses `surface`'s page has counted (the click page names them in its title).
pub fn presses(probe: &Probe, surface: &str) -> Option<u64> {
    probe
        .title(surface)?
        .split_whitespace()
        .find_map(|w| w.strip_prefix("clicks:"))?
        .parse()
        .ok()
}

/// Press `surface` and run the desk until a frame holds its next paint: milliseconds to the paint
/// and to that frame, `None` for a press whose paint never came.
pub fn to_paint(probe: &mut Probe, desk: &DeskLoop, surfaces: &[&str], surface: &str) -> Value {
    let before = probe.paints(surface);
    let sent = std::time::Instant::now();
    press(probe, surface);
    let (painted, framed) =
        probe.run_desk_until(desk, surfaces, LOST, |p| p.paints(surface) > before);
    let ms = |at: Option<std::time::Instant>| {
        at.map(|t| ((t - sent).as_secs_f64() * 1000.0 * 100.0).round() / 100.0)
    };
    json!({ "paint_ms": ms(painted), "frame_ms": ms(framed) })
}

fn quantile(values: &mut [f64], q: f64) -> Option<f64> {
    values.sort_by(f64::total_cmp);
    let at = ((values.len().max(1) - 1) as f64 * q).round() as usize;
    values.get(at).copied()
}

pub fn input(probe: &mut Probe) -> Value {
    let all = ["click", "a", "b"];
    for (id, plugin) in [
        ("click", "probe.click"),
        ("a", "probe.anim"),
        ("b", "probe.anim"),
    ] {
        probe.create(id, plugin, SIZE);
    }
    let started = probe.pump_until(START, |p| {
        all.iter().all(|s| p.pid(s).is_some() && p.paints(s) >= 1)
    });
    let desk = DeskLoop::new(probe);
    probe.run_desk(&desk, &all, Duration::from_secs(1));
    let mut tries = Vec::new();
    for i in 0..TRIES {
        tries.push(to_paint(probe, &desk, &all, "click"));
        // A different moment of the desk's frame for each press.
        probe.run_desk(
            &desk,
            &all,
            Duration::from_millis(150 + (i as u64 * 7) % 17),
        );
    }
    let pick = |key: &str| -> Vec<f64> { tries.iter().filter_map(|t| t[key].as_f64()).collect() };
    let (mut paints, mut frames) = (pick("paint_ms"), pick("frame_ms"));
    json!({
        "scenario": "input",
        "started": started,
        "presses": presses(probe, "click"),
        "tries": tries,
        "lost": TRIES - frames.len(),
        "paint_p50_ms": quantile(&mut paints, 0.5),
        "paint_p95_ms": quantile(&mut paints, 0.95),
        "frame_p50_ms": quantile(&mut frames, 0.5),
        "frame_p95_ms": quantile(&mut frames, 0.95),
    })
}
