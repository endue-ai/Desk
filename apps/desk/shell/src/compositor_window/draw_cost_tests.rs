//! What one layout of the scene costs on the main thread: the plan again (`Hosted::replan`) and the
//! scene again (`draw`), as every frame of a window gesture does. ADR 0200 measured 30 to 40 ms of
//! the debug app's main thread per layout with 13 windows. Run with
//! `cargo test -p desk-shell --lib cost_tests -- --ignored --nocapture` under the profile to compare;
//! it prints one JSON line. No GPU, no CEF: the scene is built, not rendered.

use std::time::{Duration, Instant};

use desk_compositor::{ChromeTheme, Scene, TextureId};
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
