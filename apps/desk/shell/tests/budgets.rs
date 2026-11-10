//! The compositor's budgets on the CEF desk (#58), measured through the surface probe and judged by
//! `just perf-compositor` against `e2e/perf/budgets.json` (`e2e/perf/lib/compositor.ts`): memory
//! per live surface against #35's baseline, and the start to the first composed frame holding a web
//! surface. They take a quiet machine and half a minute, so they are `#[ignore]`d in `cargo test`;
//! the runner runs them with `--ignored` and `DESK_PERF_OUT`, where each writes what it measured
//! (`<name>.measured.json`). Input to paint waits for the compositor's input path (#56).

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

/// Timed starts of the start-up measurement; its value is their median.
const RUNS: usize = 5;

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
    // on a busy machine about one start in three spent 1.4 s more before CEF was up (0.1 s
    // otherwise): one start to take the first, then the median of five so that one or two of the
    // others cannot move it.
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
    let mut firsts: Vec<f64> = runs
        .iter()
        .filter_map(|r| r["firstComposeMs"].as_f64())
        .collect();
    firsts.sort_by(f64::total_cmp);
    keep(
        "surface-startup",
        json!({ "surfaceStartup": {
            "firstComposeMs": firsts[firsts.len() / 2],
            "runs": runs,
            "platform": platform(),
        }}),
    );
}

#[test]
#[ignore = "input to paint <= 16 ms (RT-16) needs the compositor's input path (#56): a pointer \
            event routed to a surface and the frame that shows its paint"]
fn input_to_paint_within_16_ms() {
    let report = probe("input_to_paint_within_16_ms", "input", &[]);
    panic!("the probe has no input scenario until #56: {report:?}");
}
