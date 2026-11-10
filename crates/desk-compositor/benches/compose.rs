//! Compose budget (#32 §3): 15 live, titled surfaces at 2560x1440 within 4 ms a frame. Every frame moves
//! every window and repaints every texture, so every frame is a full redraw.
//!
//! `cargo bench -p desk-compositor --bench compose` measures 300 frames after 30 of warm-up and
//! prints the numbers; it is a benchmark, not a gate, until #58: set `DESK_COMPOSE_BUDGET=gate` to
//! make a median frame over budget fail. Under `cargo test` it renders a few frames as a smoke test.

#[path = "../examples/shared/mod.rs"]
mod shared;

use desk_compositor::Compositor;
use desk_compositor::headless::{Target, headless_device};
use std::time::{Duration, Instant};

const SIZE: (u32, u32) = (2560, 1440);
const SURFACES: usize = 15;
const BUDGET: Duration = Duration::from_millis(4);

fn main() {
    let benching = std::env::args().any(|a| a == "--bench");
    let (warmup, frames) = if benching { (30, 300) } else { (1, 3) };
    let gpu = match headless_device() {
        Ok(gpu) => gpu,
        Err(e) => {
            eprintln!("compose: skipped, {e}");
            return;
        }
    };
    let mut compositor = Compositor::new(&gpu.device, &gpu.queue, shared::FORMAT);
    let target = Target::new(&gpu.device, SIZE, shared::FORMAT);
    let theme = desk_compositor::ChromeTheme::from_tokens(&shared::look(""));
    let mut desk = shared::build(SIZE, SURFACES, &mut compositor, theme);
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
    println!(
        "compose/{SURFACES} surfaces/{}x{} on {} ({:?}): {frames} frames",
        SIZE.0, SIZE.1, gpu.adapter.name, gpu.adapter.backend
    );
    println!("  compose CPU ms: min {cmin:.3} median {cmed:.3} p95 {cp95:.3} max {cmax:.3}");
    println!(
        "  frame ms (animate + compose + GPU done): min {fmin:.3} median {fmed:.3} p95 {fp95:.3} max {fmax:.3}"
    );
    let within = Duration::from_secs_f64(fmed / 1000.0) <= BUDGET;
    println!(
        "  budget {} ms per frame (median): {}",
        BUDGET.as_millis(),
        if within { "within" } else { "OVER" }
    );
    let gate = std::env::var("DESK_COMPOSE_BUDGET").is_ok_and(|v| v == "gate");
    if benching && gate && !within {
        std::process::exit(1);
    }
}
