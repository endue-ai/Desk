//! Compose budget (#32 §3, a gate since #58): 15 live, titled surfaces at 2560x1440 within 4 ms a
//! frame. Every frame moves every window and repaints every texture, so every frame is a full
//! redraw. Also the compositor's own start: from asking for a device to its first composed frame of
//! that desk, GPU done (pipelines, the machine's fonts, the textures' upload, the first glyphs), the
//! median of three starts after one that warms the OS's and the driver's caches for this binary.
//!
//! `cargo bench -p desk-compositor --bench compose` measures 300 frames after 30 of warm-up and
//! prints the numbers beside the budget in `e2e/perf/budgets.json` (`compose.budgetMs`). With
//! `DESK_PERF_OUT=<dir>` it also writes `<dir>/compose.measured.json`, which `just perf-compositor`
//! judges (`e2e/perf/lib/compositor.ts`): the p95 frame over the budget fails on a GPU and is
//! reported on a software adapter. Under `cargo test` it renders a few frames as a smoke test.

#[path = "../examples/shared/mod.rs"]
mod shared;

use desk_compositor::Compositor;
use desk_compositor::headless::{Target, headless_device};
use serde_json::{Value, json};
use std::path::PathBuf;
use std::time::{Duration, Instant};

const SIZE: (u32, u32) = (2560, 1440);
const SURFACES: usize = 15;

fn budgets() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../e2e/perf/budgets.json");
    let text = std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_slice(&text).expect("budgets.json")
}

/// A compositor started and its first frame drawn: what it took, to the device and to the frame.
struct Started {
    gpu: desk_compositor::headless::Headless,
    compositor: Compositor,
    target: Target,
    desk: shared::Desk,
    device: Duration,
    first_compose: Duration,
}

/// Ask for a device, make the compositor and the desk, and draw its first frame, GPU done.
fn start() -> Result<Started, String> {
    let began = Instant::now();
    let gpu = headless_device().map_err(|e| e.to_string())?;
    let device = began.elapsed();
    let mut compositor = Compositor::new(&gpu.device, &gpu.queue, shared::FORMAT);
    let target = Target::new(&gpu.device, SIZE, shared::FORMAT);
    let theme = desk_compositor::ChromeTheme::from_tokens(&shared::look(""));
    let mut desk = shared::build(SIZE, SURFACES, &mut compositor, theme);
    shared::animate(&mut desk, &mut compositor, 0.0);
    let stats = compositor.render(&desk.scene, &target.view, target.size);
    shared::wait(&gpu.device);
    assert!(stats.drawn, "{stats:?}");
    Ok(Started {
        first_compose: began.elapsed(),
        gpu,
        compositor,
        target,
        desk,
        device,
    })
}

fn main() {
    let benching = std::env::args().any(|a| a == "--bench");
    let (warmup, frames) = if benching { (30, 300) } else { (1, 3) };
    let budget = budgets()["compose"]["budgetMs"]
        .as_f64()
        .expect("compose.budgetMs");
    // A fresh build's first start pays what the OS and the driver then keep for the binary (its
    // shaders among them), 4x a later one's here: one start to warm them, then the median of three.
    let starts = if benching { 4 } else { 1 };
    let mut runs = Vec::new();
    for _ in 0..starts {
        match start() {
            Ok(started) => runs.push(started),
            Err(e) => {
                eprintln!("compose: skipped, {e}");
                return;
            }
        }
    }
    let timed = &runs[usize::from(benching)..];
    let median = |pick: fn(&Started) -> Duration| {
        let mut times: Vec<Duration> = timed.iter().map(pick).collect();
        times.sort();
        times[times.len() / 2]
    };
    let (first_compose, device_ready) = (median(|s| s.first_compose), median(|s| s.device));
    let (cold, timed) = (runs[0].first_compose, timed.len());
    let Some(Started {
        gpu,
        mut compositor,
        target,
        mut desk,
        ..
    }) = runs.pop()
    else {
        return;
    };
    drop(runs);
    let (mut compose, mut frame) = (Vec::new(), Vec::new());
    for n in 0..warmup + frames {
        let start = Instant::now();
        shared::animate(&mut desk, &mut compositor, n as f32 / 60.0);
        let stats = compositor.render(&desk.scene, &target.view, target.size);
        shared::wait(&gpu.device);
        assert!(
            stats.drawn && stats.nodes_drawn == SURFACES * 4 && stats.missing_glyphs == 0,
            "{stats:?}"
        );
        if n >= warmup {
            frame.push(start.elapsed());
            compose.push(stats.compose_time);
        }
    }
    let [cmin, cmed, cp95, cmax] = shared::summary(&compose);
    let [fmin, fmed, fp95, fmax] = shared::summary(&frame);
    let software = gpu.adapter.device_type == wgpu::DeviceType::Cpu;
    let adapter = format!("{} ({:?})", gpu.adapter.name, gpu.adapter.backend);
    println!(
        "compose/{SURFACES} surfaces/{}x{} on {adapter}: {frames} frames",
        SIZE.0, SIZE.1
    );
    println!("  compose CPU ms: min {cmin:.3} median {cmed:.3} p95 {cp95:.3} max {cmax:.3}");
    println!(
        "  frame ms (animate + compose + GPU done): min {fmin:.3} median {fmed:.3} p95 {fp95:.3} max {fmax:.3}"
    );
    let within = fp95 <= budget;
    let verdict = match (within, software) {
        (true, _) => "within",
        (false, true) => "over, on a software adapter (reported, not failed)",
        (false, false) => "OVER",
    };
    println!("  budget {budget} ms per frame (p95): {verdict}");
    println!(
        "  start to the first composed frame: {:.1} ms, median of {} (device {:.1} ms; the first start {:.1} ms)",
        ms(first_compose),
        timed,
        ms(device_ready),
        ms(cold)
    );
    if !benching {
        return;
    }
    if let Some(dir) = std::env::var_os("DESK_PERF_OUT") {
        let context = json!({
            "adapter": adapter,
            "software": software,
            "platform": platform(),
        });
        let mut measured = json!({
            "compose": {
                "p95Ms": round3(fp95), "medianMs": round3(fmed), "composeCpuP95Ms": round3(cp95),
                "surfaces": SURFACES, "width": SIZE.0, "height": SIZE.1, "frames": frames,
            },
            "composeStartup": {
                "firstComposeMs": round1(ms(first_compose)), "deviceMs": round1(ms(device_ready)),
                "firstStartMs": round1(ms(cold)), "runs": timed,
                "surfaces": SURFACES,
            },
        });
        for section in ["compose", "composeStartup"] {
            for (key, value) in context.as_object().unwrap() {
                measured[section][key] = value.clone();
            }
        }
        let path = PathBuf::from(dir).join("compose.measured.json");
        let text = serde_json::to_string_pretty(&measured).unwrap() + "\n";
        std::fs::write(&path, text).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        println!("  measured: {}", path.display());
    }
}

/// `platform` as budgets.json names it, Node's `process.platform-process.arch`.
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

fn ms(time: Duration) -> f64 {
    time.as_secs_f64() * 1000.0
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn round3(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}
