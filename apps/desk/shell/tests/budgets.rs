//! The compositor's budgets on the CEF desk (#58), measured through the surface probe and judged by
//! `just perf-compositor` against `e2e/perf/budgets.json` (`e2e/perf/lib/compositor.ts`): memory
//! per live surface against #35's baseline, the start to the first composed frame holding a web
//! surface, a press to the composed frame holding its paint (RT-16, on #56's input path), with
//! presses CEF's busy-wait catches and presses on a desk at rest (#133), and what a desk at rest
//! costs (#129: its wake-ups, CPU). They
//! take a quiet machine and a minute, so they are `#[ignore]`d in `cargo test`; the runner runs
//! them with `--ignored` and `DESK_PERF_OUT`, where each writes what it measured
//! (`<name>.measured.json`).

mod support;

use std::path::PathBuf;

use serde_json::{Value, json};
use support::probe;

/// `platform` as budgets.json names it: `process.platform-process.arch` in Node's words.
fn platform() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        other => other,
    };
    format!("{os}-{arch}")
}

/// Keep what a test measured where the runner reads it, or print it.
fn keep(name: &str, measured: Value) {
    let text = serde_json::to_string_pretty(&measured).unwrap() + "\n";
    match std::env::var_os("DESK_PERF_OUT") {
        Some(dir) => {
            let path = PathBuf::from(dir).join(format!("{name}.measured.json"));
            std::fs::write(&path, text).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        }
        None => println!("{name}: {text}"),
    }
}

/// Timed starts of the start-up measurement; its value is their median, and the slowest is judged
/// against the same allowance (`e2e/perf/lib/compositor.ts`).
const RUNS: usize = 10;
/// A start whose CEF took this long to come up stalled (it takes about 100 ms): counted beside them.
const STALL_MS: f64 = 1000.0;

/// The middle value of `values`, or the mean of the two middle ones, as `e2e/perf/lib/stats.ts`.
fn median(values: &[f64]) -> Option<f64> {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let middle = sorted.len() / 2;
    match sorted.len() {
        0 => None,
        n if n % 2 == 0 => Some((sorted[middle - 1] + sorted[middle]) / 2.0),
        _ => Some(sorted[middle]),
    }
}

#[test]
fn the_median_of_an_even_count_is_the_mean_of_the_middle_two() {
    assert_eq!(median(&[3.0, 1.0, 2.0]), Some(2.0));
    assert_eq!(median(&[4.0, 1.0, 3.0, 2.0]), Some(2.5));
    assert_eq!(median(&[]), None);
}

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs_f64() * 1000.0)
}

#[test]
#[ignore = "perf: just perf-compositor"]
fn perf_memory_per_live_surface() {
    let Some(report) = probe("perf_memory_per_live_surface", "memory", &[]) else {
        return;
    };
    eprintln!("memory: {report}");
    assert_eq!(
        report["started"], true,
        "ten light surfaces painting: {report}"
    );
    let per_surface = report["per_surface_mb"].as_f64().unwrap_or(0.0);
    assert!(per_surface > 0.0, "{report}");
    let (one, ten) = (&report["one"], &report["ten"]);
    assert!(
        ten["renderers"].as_u64() >= Some(10),
        "a renderer each: {report}"
    );
    keep(
        "surface-memory",
        json!({ "surfaceMemory": {
            "perSurfaceMb": per_surface,
            "tool": ten["tool"],
            "platform": platform(),
            "oneMb": one["total_mb"],
            "tenMb": ten["total_mb"],
            "renderers": ten["renderers"],
        }}),
    );
}

#[test]
#[ignore = "perf: just perf-compositor"]
fn perf_start_to_the_first_composed_web_surface() {
    // A bundle's first start after it was laid out pays the OS's first look at the new binary: one
    // start to take it, then ten in a row, whose median is the value and whose slowest is judged
    // too. Until #112 two starts in five spent 1.4 s more before `main` (Chromium's code-sign clone
    // made macOS assess the executable again), so the measure was the fastest of five; a start
    // that stalls like that again fails the slowest. Stalls are counted beside them.
    if probe(
        "perf_start_to_the_first_composed_web_surface",
        "startup",
        &[],
    )
    .is_none()
    {
        return;
    }
    let mut runs = Vec::new();
    for run in 0..RUNS {
        let spawned = now_ms();
        let Some(report) = probe(
            "perf_start_to_the_first_composed_web_surface",
            "startup",
            &[],
        ) else {
            return;
        };
        eprintln!("startup {run}: {report}");
        let at = |key: &str| {
            report[key]
                .as_f64()
                .map(|t| ((t - spawned) * 10.0).round() / 10.0)
        };
        let first = at("first_surface_compose")
            .unwrap_or_else(|| panic!("no frame held the surface: {report}"));
        runs.push(json!({
            "firstComposeMs": first,
            "cefReadyMs": at("cef_ready"),
            "gpuReadyMs": at("gpu_ready"),
            "deskFirstFrameMs": at("first_compose"),
            "firstPaintMs": report["first_paint_ms"],
        }));
    }
    let firsts: Vec<f64> = runs
        .iter()
        .filter_map(|r| r["firstComposeMs"].as_f64())
        .collect();
    let slowest = firsts.iter().copied().fold(f64::MIN, f64::max);
    let stalls = runs
        .iter()
        .filter(|r| r["cefReadyMs"].as_f64().is_some_and(|ms| ms > STALL_MS))
        .count();
    keep(
        "surface-startup",
        json!({ "surfaceStartup": {
            "firstComposeMs": median(&firsts).map(|ms| (ms * 10.0).round() / 10.0),
            "slowestMs": slowest,
            "stalls": stalls,
            "runs": runs,
            "platform": platform(),
        }}),
    );
}

#[test]
#[ignore = "perf: just perf-compositor"]
fn perf_input_to_paint() {
    let Some(report) = probe("perf_input_to_paint", "input", &[]) else {
        return;
    };
    eprintln!("input: {report}");
    assert_eq!(report["started"], true, "{report}");
    assert_eq!(
        report["lost"], 0,
        "every press reached a composed frame: {report}"
    );
    assert_eq!(
        report["presses"], 25,
        "the page counted every press, the five a busy-wait caught too: {report}"
    );
    let busy = &report["busy"];
    assert_eq!(
        busy["spun"], 5,
        "each caught press met a busy-wait: {report}"
    );
    keep(
        "input-to-paint",
        json!({ "inputToPaint": {
            "p95Ms": report["paint_p95_ms"],
            "p50Ms": report["paint_p50_ms"],
            "frameP50Ms": report["frame_p50_ms"],
            "frameP95Ms": report["frame_p95_ms"],
            "caughtWaitMs": busy["after_p50_ms"],
            "caughtWaitMaxMs": busy["after_max_ms"],
            "caughtPaintP50Ms": busy["paint_p50_ms"],
            "caughtPaintMaxMs": busy["paint_max_ms"],
            "caughtFrameP50Ms": busy["frame_p50_ms"],
            "caughtByChance": report["caught"],
            "tries": report["tries"].as_array().map_or(0, Vec::len),
            "adapter": report["adapter"],
            "software": report["adapter_type"] == "Cpu",
            "platform": platform(),
        }}),
    );
}

#[test]
#[ignore = "perf: just perf-compositor"]
fn perf_desk_at_rest() {
    let Some(report) = probe("perf_desk_at_rest", "rest", &[]) else {
        return;
    };
    eprintln!("rest: {report}");
    assert_eq!(report["started"], true, "{report}");
    let rest = &report["rest"];
    assert_eq!(
        rest["paints_per_s"], 0.0,
        "nothing painted at rest: {report}"
    );
    // A page's own change on a desk at rest still shows (#134).
    let changes: Vec<f64> = report["own_changes"]["ms"]
        .as_array()
        .map(|c| c.iter().filter_map(Value::as_f64).collect())
        .unwrap_or_default();
    assert_eq!(
        changes.len(),
        3,
        "each change a long-idle page made painted: {report}"
    );
    keep(
        "desk-at-rest",
        json!({ "deskAtRest": {
            "wakeupsPerSecond": rest["turns_per_s"],
            "osWakeupsPerSecond": rest["os_wakeups_per_s"],
            "cefWorksPerSecond": rest["works_per_s"],
            "cefWorkMsPerSecond": rest["work_ms_per_s"],
            "longWorks": rest["long_works"],
            "cpuPercent": rest["cpu_percent"],
            "gpuCpuPercent": rest["gpu_cpu_percent"],
            "renderersCpuPercent": rest["renderers_cpu_percent"],
            "beginFramesPerSecond": rest["begin_frames_per_s"],
            "ownChangeMs": median(&changes),
            "ownChangeMaxMs": changes.iter().copied().fold(f64::MIN, f64::max),
            "seconds": rest["seconds"],
            "platform": platform(),
        }}),
    );
}

/// The presses the `idle-input` run makes, each after the desk rested 2 to 3 s.
const IDLE_PRESSES: u64 = 12;

#[test]
#[ignore = "perf: just perf-compositor"]
fn perf_input_from_rest() {
    let Some(report) = probe("perf_input_from_rest", "idle-input", &[]) else {
        return;
    };
    eprintln!("idle input: {report}");
    assert_eq!(report["started"], true, "{report}");
    assert_eq!(
        report["lost"], 0,
        "every press reached a composed frame: {report}"
    );
    assert_eq!(
        report["clicks"], IDLE_PRESSES,
        "the pages counted every press: {report}"
    );
    keep(
        "input-from-rest",
        json!({ "inputFromRest": {
            "p95Ms": report["paint_p95_ms"],
            "p50Ms": report["paint_p50_ms"],
            "maxMs": report["paint_max_ms"],
            "frameP50Ms": report["frame_p50_ms"],
            "tries": report["tries"].as_array().map_or(0, Vec::len),
            "adapter": report["adapter"],
            "software": report["adapter_type"] == "Cpu",
            "platform": platform(),
        }}),
    );
}
