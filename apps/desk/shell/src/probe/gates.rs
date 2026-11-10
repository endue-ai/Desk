//! The compositor's gates (#58) as probe scenarios, each over the probe's desk (`desk_loop.rs`).
//! Each returns numbers; `tests/isolation.rs` and `tests/budgets.rs` judge them.
//!
//! - `isolation`: two animating surfaces beside one whose main thread is made to spin forever and
//!   one whose renderer is killed: the desk's frames and the others' paints before, during the spin
//!   and through the death, and a press on a fifth that it paints, before and after.
//! - `cap`: a surface whose page keeps allocating is put to sleep when its renderer passes a memory
//!   cap. The probe applies the cap itself, as the host's live budget will (ADR 0142, #81): what is
//!   gated is that the sleep holds under the pressure, the renderer and its memory go, its last
//!   frame stays and the desk and the others never stop.
//! - `memory`: the process tree's memory with one and with ten of #35's light surfaces.
//! - `startup`: when CEF, the compositor and the first composed frame holding a web surface came.

use std::time::{Duration, Instant};

use cef::{ImplBrowser, ImplFrame};
use serde_json::{Map, Value, json};

use super::desk_loop::{DeskLoop, cpu_seconds, memory as tree_memory, rss_mb, tree};
use super::input_gate::{presses, to_paint};
use super::{Probe, alive, epoch_ms, kill};

const SIZE: (u32, u32) = (320, 200);
const START: Duration = Duration::from_secs(20);
/// The `cap` scenario's memory cap: the resident set of its surface's renderer.
pub const CAP_MB: f64 = 256.0;
/// #35's surface: 800x600 logical at scale 2.
const LIGHT: (u32, u32) = (800, 600);
const SETTLE: Duration = Duration::from_secs(12);

/// Run the desk for `time` and say how it went: its frames and each surface's paints per second.
fn stretch(probe: &mut Probe, desk: &DeskLoop, surfaces: &[&str], time: Duration) -> Value {
    let before: Vec<u64> = surfaces.iter().map(|s| probe.paints(s)).collect();
    let frames = probe.run_desk(desk, surfaces, time);
    let rates: Map<String, Value> = surfaces
        .iter()
        .zip(before)
        .map(|(s, b)| {
            let rate = (probe.paints(s) - b) as f64 / time.as_secs_f64();
            ((*s).to_owned(), json!((rate * 10.0).round() / 10.0))
        })
        .collect();
    json!({ "seconds": time.as_secs_f64(), "frames": frames.report(), "paints_per_s": rates })
}

pub fn isolation(probe: &mut Probe) -> Value {
    let all = ["a", "b", "busy", "victim", "click"];
    for (id, plugin) in [
        ("a", "probe.anim"),
        ("b", "probe.anim"),
        ("busy", "probe.busy"),
        ("victim", "probe.anim"),
        ("click", "probe.click"),
    ] {
        probe.create(id, plugin, SIZE);
    }
    let started = probe.pump_until(START, |p| {
        all.iter()
            .all(|s| p.pid(s).is_some() && (p.paints(s) >= 5 || *s == "click"))
    });
    let desk = DeskLoop::new(probe);
    let before = stretch(probe, &desk, &all, Duration::from_secs(2));
    let pressed_before = to_paint(probe, &desk, &all, "click");

    // Busy: the page's main thread never returns.
    let busy_pid = probe.pid("busy");
    let spun = probe
        .host
        .browser("busy")
        .and_then(|b| b.main_frame())
        .map(|frame| frame.execute_java_script(Some(&"setTimeout(spin, 0)".into()), None, 0))
        .is_some();
    probe.pump_for(Duration::from_millis(300));
    let cpu_before = busy_pid.and_then(cpu_seconds);
    let busy_for = Duration::from_secs(3);
    let busy = stretch(probe, &desk, &all, busy_for);
    let cores = cpu_before
        .zip(busy_pid.and_then(cpu_seconds))
        .map(|(a, b)| ((b - a) / busy_for.as_secs_f64() * 100.0).round() / 100.0);

    // Killed: one renderer ends without being asked, while the other one still spins.
    let victim_pid = probe.pid("victim");
    let killed = victim_pid.is_some_and(kill);
    let death = stretch(probe, &desk, &all, Duration::from_secs(2));
    // A neighbour of the dead one (and of the spinning one) still takes a press and paints it.
    let pressed_after = to_paint(probe, &desk, &all, "click");
    let deaths = probe.deaths().to_vec();
    // A renderer that spins never unloads: end it so the probe can close.
    if let Some(pid) = busy_pid {
        kill(pid);
    }
    json!({
        "scenario": "isolation",
        "started": started,
        "before": before,
        "busy": { "spun": spun, "cores": cores, "desk": busy },
        "death": { "killed": killed, "deaths": deaths, "desk": death },
        "input": { "before": pressed_before, "after": pressed_after, "presses": presses(probe, "click") },
    })
}

pub fn cap(probe: &mut Probe) -> Value {
    let all = ["a", "b", "hog"];
    for (id, plugin) in [
        ("a", "probe.anim"),
        ("b", "probe.anim"),
        ("hog", "probe.hog"),
    ] {
        probe.create(id, plugin, SIZE);
    }
    let started = probe.pump_until(START, |p| {
        all.iter().all(|s| p.pid(s).is_some() && p.paints(s) >= 1)
    });
    let hog_pid = probe.pid("hog");
    let desk = DeskLoop::new(probe);
    let began = Instant::now();
    let (mut peak, mut reached) = (0.0f64, None);
    while reached.is_none() && began.elapsed() < START {
        probe.run_desk(&desk, &all, Duration::from_millis(100));
        let Some(rss) = hog_pid.and_then(rss_mb) else {
            break;
        };
        peak = peak.max(rss);
        if rss >= CAP_MB {
            reached = Some(began.elapsed());
        }
    }
    let held = probe
        .title("hog")
        .and_then(|t| t.split_whitespace().find_map(|w| w.strip_prefix("mb:")))
        .and_then(|mb| mb.parse::<u64>().ok());
    // At the cap: asleep, as the live budget puts a surface to sleep.
    probe.send(json!({ "type": "sleep", "surface": "hog" }));
    let after = stretch(probe, &desk, &all, Duration::from_secs(3));
    let gone = probe.pump_until(Duration::from_secs(5), |_| {
        hog_pid.and_then(alive) != Some(true)
    });
    json!({
        "scenario": "cap",
        "started": started,
        "cap_mb": CAP_MB,
        "peak_mb": (peak * 10.0).round() / 10.0,
        "reached_ms": reached.map(|d| d.as_millis() as u64),
        "held_mb": held,
        "asleep": {
            "browser": probe.host.browser("hog").is_some(),
            "state": probe.host.counts("hog").map(|(_, s, _)| format!("{s:?}")),
            "renderer_alive": hog_pid.and_then(alive),
            "renderer_gone": gone,
            "last_frame": probe.middle("hog"),
        },
        "deaths": probe.deaths(),
        "desk": after,
    })
}

/// The tree's memory now, in MiB: in total and by kind of process.
fn sample() -> Value {
    let tree = tree();
    let pids: Vec<u32> = tree.iter().map(|(p, _)| *p).collect();
    let (found, tool) = tree_memory(&pids);
    let mut by_kind = Map::new();
    for (pid, mb) in &found {
        let kind = tree.iter().find(|(p, _)| p == pid).map_or("?", |(_, k)| k);
        let sum = by_kind.get(kind).and_then(Value::as_f64).unwrap_or(0.0) + mb;
        by_kind.insert(kind.to_owned(), json!(sum));
    }
    let total: f64 = found.iter().map(|(_, mb)| mb).sum();
    let renderers = tree.iter().filter(|(_, k)| k == "renderer").count();
    json!({ "tool": tool, "total_mb": total, "by_kind": by_kind, "renderers": renderers, "processes": found.len() })
}

pub fn memory(probe: &mut Probe) -> Value {
    let ids: Vec<String> = (0..10).map(|i| format!("l{i}")).collect();
    let all: Vec<&str> = ids.iter().map(String::as_str).collect();
    probe.create(all[0], "probe.light", LIGHT);
    let one_started = probe.pump_until(START, |p| p.paints("l0") >= 10);
    let desk = DeskLoop::new(probe);
    probe.run_desk(&desk, &all[..1], SETTLE);
    let one = sample();
    for id in &all[1..] {
        probe.create(id, "probe.light", LIGHT);
    }
    let ten_started = probe.pump_until(START, |p| all.iter().all(|s| p.paints(s) >= 10));
    probe.run_desk(&desk, &all, SETTLE);
    let ten = sample();
    let per_surface =
        (ten["total_mb"].as_f64().unwrap_or(0.0) - one["total_mb"].as_f64().unwrap_or(0.0)) / 9.0;
    json!({
        "scenario": "memory",
        "started": one_started && ten_started,
        "one": one,
        "ten": ten,
        "per_surface_mb": (per_surface * 10.0).round() / 10.0,
        "view": [LIGHT.0, LIGHT.1],
    })
}

pub fn startup(probe: &mut Probe) -> Value {
    probe.create("first", "probe.colour", SIZE);
    let desk = DeskLoop::new(probe);
    let began = Instant::now();
    let (mut first, mut with_surface) = (None, None);
    while with_surface.is_none() && began.elapsed() < START {
        let frames = probe.run_desk(&desk, &["first"], Duration::from_millis(20));
        first = first.or(frames.first);
        with_surface = frames.first_with_surface;
    }
    json!({
        "scenario": "startup",
        "cef_ready": probe.cef_ready,
        "gpu_ready": probe.gpu_ready,
        "first_compose": first,
        "first_surface_compose": with_surface,
        "first_paint_ms": probe.host.counts("first").and_then(|(c, _, _)| c.first_paint_ms),
        "reported": epoch_ms(),
    })
}
