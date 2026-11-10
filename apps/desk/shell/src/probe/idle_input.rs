//! Presses on a desk at rest (#133): three still surfaces, two of them the click page, and twelve
//! presses, each on the click surface not pressed last, after the desk rested two to three seconds
//! (`Probe::rest_for`, the window's event loop at rest): every pressed surface is long idle, on the
//! slow clock (`web_host/frames.rs`), and nothing on the desk has painted for seconds. From each
//! press to its paint reaching the compositor and to the desk's first composed frame holding it.
//! `tests/budgets.rs` judges the paint against RT-16's 16 ms at p95 through `just perf-compositor`.

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
/// The presses, each after the desk rested `RESTS[i % 3]`.
pub const PRESSES: usize = 12;
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
    let mut tries = Vec::new();
    for i in 0..PRESSES {
        let rest = RESTS[i % RESTS.len()];
        probe.rest_for(rest);
        // The desk composed nothing while it rested: its next frame is a frame from the press.
        desk.rested();
        let surface = ids[i % 2];
        let mut press = to_paint(probe, &desk, &ids, surface);
        press["surface"] = json!(surface);
        press["rest_ms"] = json!(rest.as_millis() as u64);
        tries.push(press);
    }
    let pick = |key: &str| -> Vec<f64> { tries.iter().filter_map(|t| t[key].as_f64()).collect() };
    let (mut paints, mut frames) = (pick("paint_ms"), pick("frame_ms"));
    let clicks = [ids[0], ids[1]].map(|s| presses(probe, s));
    json!({
        "scenario": "idle-input",
        "started": started,
        "tries": tries,
        "lost": PRESSES - frames.len(),
        "clicks": clicks.iter().flatten().sum::<u64>(),
        "paint_p50_ms": quantile(&mut paints, 0.5),
        "paint_p95_ms": quantile(&mut paints, 0.95),
        "paint_max_ms": quantile(&mut paints, 1.0),
        "frame_p50_ms": quantile(&mut frames, 0.5),
    })
}
