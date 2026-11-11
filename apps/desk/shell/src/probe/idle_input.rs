//! Presses on a desk at rest (#133): three still surfaces, two of them the click page, and presses,
//! each on the click surface not pressed last, after the desk rested two to three seconds
//! (`Probe::rest_for`, the window's event loop at rest): every pressed surface is long idle, on the
//! slow clock (`web_host/frames.rs`), and nothing on the desk has painted for seconds. From each
//! press to its paint reaching the compositor and to the desk's first composed frame holding it.
//! `tests/budgets.rs` judges the paint against RT-16's 16 ms at p95 through `just perf-compositor`.
//!
//! A press from rest waits for the machine's cores to wake (#148): on a quiet machine presses
//! painted 5.8 to 15.8 ms after them, with one busy loop anywhere on it 6.5 to 7.8, so a burst of
//! other work, or its end, moves a run's p95 by several milliseconds. The run presses once first, not counted
//! (the first press after the surfaces' start was the slowest or above the median in seven runs of
//! eleven), then `BLOCKS` blocks of `PRESSES`, and reports the block whose p95 is the median: one
//! block a burst moved does not decide it, a change that slows every press does.

use std::time::Duration;

use serde_json::{Value, json};

use super::Probe;
use super::desk_loop::DeskLoop;
use super::input_gate::{presses, to_paint};

const SIZE: (u32, u32) = (320, 200);
const START: Duration = Duration::from_secs(20);
const SURFACES: [(&str, &str); 3] = [
    ("click", "probe.click"),
    ("other", "probe.click"),
    ("still", "probe.colour"),
];
/// The presses a block makes, each after the desk rested `RESTS[i % 3]`.
pub const PRESSES: usize = 12;
/// The blocks a run makes, after its `WARM_UP` presses.
pub const BLOCKS: usize = 3;
/// Presses before the blocks, not counted.
pub const WARM_UP: usize = 1;
const RESTS: [Duration; 3] = [
    Duration::from_millis(2000),
    Duration::from_millis(2500),
    Duration::from_millis(3000),
];

fn quantile(values: &mut [f64], q: f64) -> Option<f64> {
    values.sort_by(f64::total_cmp);
    let at = ((values.len().max(1) - 1) as f64 * q).round() as usize;
    values.get(at).copied()
}

/// The press `i` of the run on `ids`' click surfaces, after its rest.
fn press(probe: &mut Probe, desk: &DeskLoop, ids: &[&str], i: usize) -> Value {
    let rest = RESTS[i % RESTS.len()];
    probe.rest_for(rest);
    // The desk composed nothing while it rested: its next frame is a frame from the press.
    desk.rested();
    let surface = ids[i % 2];
    let mut press = to_paint(probe, desk, ids, surface);
    press["surface"] = json!(surface);
    press["rest_ms"] = json!(rest.as_millis() as u64);
    press
}

/// One block's presses and their figures.
fn block(tries: Vec<Value>) -> Value {
    let pick = |key: &str| -> Vec<f64> { tries.iter().filter_map(|t| t[key].as_f64()).collect() };
    let (mut paints, mut frames) = (pick("paint_ms"), pick("frame_ms"));
    json!({
        "lost": PRESSES - frames.len(),
        "paint_p50_ms": quantile(&mut paints, 0.5),
        "paint_p95_ms": quantile(&mut paints, 0.95),
        "paint_max_ms": quantile(&mut paints, 1.0),
        "frame_p50_ms": quantile(&mut frames, 0.5),
        "tries": tries,
    })
}

pub fn idle_input(probe: &mut Probe) -> Value {
    for (id, plugin) in SURFACES {
        probe.create(id, plugin, SIZE);
    }
    let started = probe.pump_until(START, |p| {
        SURFACES
            .iter()
            .all(|(s, _)| p.pid(s).is_some() && p.paints(s) >= 1)
    });
    let ids = SURFACES.map(|(id, _)| id);
    let desk = DeskLoop::new(probe);
    let warm_up: Vec<Value> = (0..WARM_UP).map(|i| press(probe, &desk, &ids, i)).collect();
    let mut blocks: Vec<Value> = (0..BLOCKS)
        .map(|b| {
            let first = WARM_UP + b * PRESSES;
            block(
                (first..first + PRESSES)
                    .map(|i| press(probe, &desk, &ids, i))
                    .collect(),
            )
        })
        .collect();
    let clicks = [ids[0], ids[1]].map(|s| presses(probe, s));
    let p95s: Vec<Value> = blocks.iter().map(|b| b["paint_p95_ms"].clone()).collect();
    let lost: u64 = blocks.iter().filter_map(|b| b["lost"].as_u64()).sum();
    blocks.sort_by(|a, b| {
        let p95 = |v: &Value| v["paint_p95_ms"].as_f64().unwrap_or(f64::INFINITY);
        p95(a).total_cmp(&p95(b))
    });
    let median = blocks.swap_remove(BLOCKS / 2);
    json!({
        "scenario": "idle-input",
        "started": started,
        "warm_up": warm_up,
        "block_p95_ms": p95s,
        "tries": median["tries"],
        "lost": lost,
        "clicks": clicks.iter().flatten().sum::<u64>(),
        "paint_p50_ms": median["paint_p50_ms"],
        "paint_p95_ms": median["paint_p95_ms"],
        "paint_max_ms": median["paint_max_ms"],
        "frame_p50_ms": median["frame_p50_ms"],
    })
}
