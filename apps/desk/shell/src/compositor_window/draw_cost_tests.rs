//! What one layout of the scene costs on the main thread: the plan again (`Hosted::replan`) and the
//! scene again (`draw`), as every frame of a window gesture does. ADR 0200 measured 30 to 40 ms of
//! the debug app's main thread per layout with 13 windows. Run with
//! `cargo test -p desk-shell --lib cost_tests -- --ignored --nocapture` under the profile to compare;
//! it prints one JSON line. No GPU, no CEF: the scene is built, not rendered.
//!
//! The budget (not ignored): one step of a title-bar drag through desk-wm, with the plan and the
//! scene again as the shell does for each pointer move, stays within half a 60 Hz frame at the 95th
//! percentile, so the rest of the frame is left for CEF, the page's report and the GPU.

use std::time::{Duration, Instant};

use desk_compositor::{ChromeTheme, Scene, TextureId};
use desk_wm::Point;
use desk_wm::interact::Kind;
use serde_json::json;

use super::{Sources, Texture, draw};
use crate::compositor_window::draw_map;
use crate::compositor_window::hosted::Hosted;
use crate::compositor_window::report::DeskReport;

const WINDOWS: usize = 13;
const RUNS: usize = 200;

/// The desk page's named parts (ADR 0160), each reported with a box.
const PARTS: [(&str, [f64; 4]); 10] = [
    ("desk.profiles", [0.0, 0.0, 240.0, 40.0]),
    ("desk.desktops", [240.0, 0.0, 400.0, 40.0]),
    ("desk.agents", [0.0, 40.0, 56.0, 760.0]),
    ("desk.account", [1380.0, 0.0, 60.0, 40.0]),
    ("desk.rail", [1384.0, 40.0, 56.0, 760.0]),
    ("desk.bottom", [0.0, 800.0, 1440.0, 100.0]),
    ("desk.eris", [1200.0, 60.0, 160.0, 160.0]),
    ("desk.notices", [1040.0, 60.0, 320.0, 80.0]),
    ("desk.settings", [400.0, 120.0, 640.0, 520.0]),
    ("desk.studios", [420.0, 140.0, 600.0, 480.0]),
];

/// `WINDOWS` plugin windows, each with a live frame, on a 1440x900 desk at a scale of 2; with
/// `parts`, the desk page's named parts too.
fn desk(parts: bool) -> Hosted {
    let frames: Vec<_> = (0..WINDOWS)
        .map(|i| {
            json!({ "plugin": format!("endue.p{i}"), "host": format!("main.endue-p{i}"),
                "src": format!("desk-plugin://main.endue-p{i}/index.html"), "loads": 1,
                "state": "live" })
        })
        .collect();
    let parts: Vec<_> = (PARTS.iter().filter(|_| parts))
        .map(|(id, [x, y, w, h])| json!({ "id": id, "x": x, "y": y, "width": w, "height": h }))
        .collect();
    let report: DeskReport = serde_json::from_value(json!({
        "seq": 1, "width": 1440, "height": 900, "frames": frames, "parts": parts,
    }))
    .unwrap();
    let mut hosted = Hosted::new(2.0);
    let adopt: Vec<_> = (0..WINDOWS)
        .map(|i| desk_wm::edits::Edit::Adopt {
            id: format!("endue.p{i}"),
            title: format!("Window {i} with a title of some length"),
        })
        .collect();
    hosted.wm.edit(1, &adopt);
    hosted.apply(report, Instant::now());
    hosted
}

fn texture(surface: &str) -> Option<Texture> {
    let i: u64 = surface.strip_prefix("main.endue-p")?.parse().ok()?;
    Some((TextureId(10 + i), (800, 526)))
}

fn percentile(sorted: &[Duration], p: f64) -> f64 {
    let at = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    sorted[at].as_secs_f64() * 1000.0
}

/// The plan and the scene again `RUNS` times after ten of warm-up; with `map`, the canvas map laid
/// out and drawn unfolded as well (its thumbnails' GPU work is not part of this).
fn layouts(mut hosted: Hosted, map: bool) -> Vec<Duration> {
    let mut scene = Scene::new(2880, 1800);
    let theme = ChromeTheme::default();
    let none = |_: &str| None;
    let mut once = || {
        let started = Instant::now();
        hosted.replan(Instant::now());
        let layout = map.then(|| draw_map::layout(&hosted, None)).flatten();
        let sources = Sources {
            scale: 2.0,
            page: Some((TextureId(1), (2880, 1800))),
            surface: &texture,
            popup: &crate::compositor_window::draw_popup::none,
            spread: None,
            map: layout.as_ref().map(|layout| draw_map::MapSource {
                layout,
                folded: false,
                thumbnail: &none,
            }),
        };
        draw(&mut scene, &theme, &hosted, &sources).unwrap();
        started.elapsed()
    };
    for _ in 0..10 {
        once();
    }
    let mut runs: Vec<Duration> = (0..RUNS).map(|_| once()).collect();
    runs.sort();
    runs
}

/// Half a 60 Hz frame: the most one gesture step may take of the main thread.
const STEP_BUDGET: Duration = Duration::from_micros(8_333);
/// The pointer moves of the drag, 3 px and 8 ms apart.
const MOVES: usize = 120;

#[test]
fn a_drag_step_of_a_thirteen_window_desk_fits_in_half_a_frame() {
    let mut hosted = desk(true);
    let start = Instant::now();
    let ms = |at: Instant| at.duration_since(start).as_secs_f64() * 1000.0;
    hosted.replan(start);
    let window = "endue.p0";
    let rect = hosted
        .wm
        .drawn_rect(window, 0.0)
        .expect("the window is drawn");
    let mut at = Point {
        x: rect.x + rect.w / 2.0,
        y: rect.y + 10.0,
    };
    hosted.wm.pressed(at);
    let kind = Kind::Move {
        window: window.into(),
    };
    hosted.wm.grab(kind, at, 0.0);
    let mut scene = Scene::new(2880, 1800);
    let theme = ChromeTheme::default();
    let sources = Sources {
        scale: 2.0,
        page: Some((TextureId(1), (2880, 1800))),
        surface: &texture,
        popup: &crate::compositor_window::draw_popup::none,
        spread: None,
        map: None,
    };
    let mut steps: Vec<Duration> = (0..MOVES)
        .map(|i| {
            at.x += 3.0;
            let now = start + Duration::from_millis(8 * (i as u64 + 1));
            let began = Instant::now();
            hosted.wm.moved(at, ms(now));
            hosted.replan(now);
            draw(&mut scene, &theme, &hosted, &sources).unwrap();
            began.elapsed()
        })
        .collect();
    assert_eq!(
        hosted.wm.held(),
        Some(window),
        "the drag ran: desk-wm holds the window"
    );
    steps.sort();
    let p95 = percentile(&steps, 0.95);
    println!(
        "drag-step-cost {}",
        json!({ "windows": WINDOWS, "moves": MOVES, "p50Ms": percentile(&steps, 0.5),
            "p95Ms": p95, "budgetMs": STEP_BUDGET.as_secs_f64() * 1000.0 })
    );
    assert!(
        p95 <= STEP_BUDGET.as_secs_f64() * 1000.0,
        "a drag step took {p95:.2} ms at the 95th percentile, over half a frame"
    );
}

#[test]
#[ignore = "measures the layout's cost; run with --ignored --nocapture"]
fn one_layout_of_a_desk_of_thirteen_windows() {
    for (name, parts, map) in [("windows", false, false), ("windows+parts+map", true, true)] {
        let runs = layouts(desk(parts), map);
        let line = json!({
            "case": name,
            "windows": WINDOWS,
            "runs": RUNS,
            "debugAssertions": cfg!(debug_assertions),
            "p50Ms": percentile(&runs, 0.5),
            "p95Ms": percentile(&runs, 0.95),
            "maxMs": percentile(&runs, 1.0),
        });
        println!("layout-cost {line}");
    }
}
