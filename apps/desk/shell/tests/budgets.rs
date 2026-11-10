//! The compositor's budgets on the CEF desk (#58), measured through the surface probe and judged by
//! `just perf-compositor` against `e2e/perf/budgets.json` (`e2e/perf/lib/compositor.ts`): memory
//! per live surface against #35's baseline, the start to the first composed frame holding a web
//! surface, and a press to the composed frame holding its paint (RT-16, on #56's input path). They
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

/// Timed starts of the start-up measurement; its value is the fastest.
const RUNS: usize = 5;
/// A start whose CEF took this long to come up stalled (it takes about 100 ms).
const STALL_MS: f64 = 1000.0;

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
    // A bundle's first start after it was laid out pays the OS's first look at the new binary, and
    // two starts in five of the rest spent 1.4 s more before CEF was up (0.1 s otherwise), busy
    // machine or quiet: one start to take the first, then the fastest of five, which is what the
    // desk's own work costs. The stalls are counted beside it and kept in `runs`.
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
    let fastest = runs
        .iter()
        .filter_map(|r| r["firstComposeMs"].as_f64())
        .fold(f64::MAX, f64::min);
    let stalls = runs
        .iter()
        .filter(|r| r["cefReadyMs"].as_f64().is_some_and(|ms| ms > STALL_MS))
        .count();
    keep(
        "surface-startup",
        json!({ "surfaceStartup": {
            "firstComposeMs": fastest,
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
        report["presses"], 20,
        "the page counted every press: {report}"
    );
    keep(
        "input-to-paint",
        json!({ "inputToPaint": {
            "p95Ms": report["paint_p95_ms"],
            "p50Ms": report["paint_p50_ms"],
            "frameP50Ms": report["frame_p50_ms"],
            "frameP95Ms": report["frame_p95_ms"],
            "tries": report["tries"].as_array().map_or(0, Vec::len),
            "adapter": report["adapter"],
            "software": report["adapter_type"] == "Cpu",
            "platform": platform(),
        }}),
    );
}
