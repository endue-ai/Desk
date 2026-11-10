//! The probe's desk (#58): the surfaces drawn as the compositor window draws them, quads in a grid
//! over a wallpaper composed into an off-screen 1920x1080 target every 16.7 ms while CEF's work runs
//! between frames, every frame a full redraw. What a gate reads from it is the desk's own frame
//! time: how far apart its frames came and how long each took. And the processes behind it, read
//! from outside: the tree's memory (macOS `footprint`, as #35 measured; RSS elsewhere), one
//! process's RSS and CPU.

use std::cell::Cell;
use std::time::{Duration, Instant};

use desk_compositor::headless::Target;
use desk_compositor::{Color, Rect, Scene, SurfaceNode, Wallpaper};
use serde_json::{Value, json};

use super::Probe;

const SIZE: (u32, u32) = (1920, 1080);
const FRAME: Duration = Duration::from_micros(16_667);

/// The desk's off-screen target, and when its next frame is due: the desk keeps its own cadence
/// across stretches, as a display's vsync would, whatever a gate does between them.
pub struct DeskLoop {
    target: Target,
    next: Cell<Instant>,
}

/// One stretch of the desk's frames.
#[derive(Default)]
pub struct Frames {
    /// From one frame's start to the next's.
    pub intervals: Vec<Duration>,
    /// Each frame's compose, GPU done.
    pub work: Vec<Duration>,
    /// The epoch time (ms) of the first frame, and of the first that drew a surface's texture.
    pub first: Option<f64>,
    pub first_with_surface: Option<f64>,
}

impl Frames {
    pub fn report(&self) -> Value {
        let p = |times: &[Duration], q: f64| quantile(times, q);
        json!({
            "frames": self.work.len(),
            "interval_p50_ms": p(&self.intervals, 0.5),
            "interval_p95_ms": p(&self.intervals, 0.95),
            "interval_max_ms": p(&self.intervals, 1.0),
            "compose_p95_ms": p(&self.work, 0.95),
            "compose_max_ms": p(&self.work, 1.0),
        })
    }
}

fn quantile(times: &[Duration], q: f64) -> Option<f64> {
    let mut ms: Vec<f64> = times.iter().map(|d| d.as_secs_f64() * 1000.0).collect();
    ms.sort_by(f64::total_cmp);
    let at = ((ms.len().max(1) - 1) as f64 * q).round() as usize;
    ms.get(at).map(|v| (v * 100.0).round() / 100.0)
}

impl DeskLoop {
    pub fn new(probe: &Probe) -> DeskLoop {
        let composed = probe.shared.lock();
        let device = composed.compositor.device().clone();
        let target = Target::new(&device, SIZE, composed.compositor.format());
        DeskLoop {
            target,
            next: Cell::new(Instant::now()),
        }
    }

    /// The frame that started at `start` is drawn: the next is due a frame after this one was,
    /// or a frame from now when the desk fell behind.
    fn drawn(&self, start: Instant) {
        let due = self.next.get() + FRAME;
        self.next.set(if due > start { due } else { start + FRAME });
    }

    /// The desk composed nothing for a while (at rest, as the window composes only what changed):
    /// its next frame is a frame from now, not at once (#129).
    pub fn rested(&self) {
        self.next.set(Instant::now() + FRAME);
    }
}

impl Probe {
    /// Run the desk for `time` over `surfaces`: CEF's work as it asks and a composed frame every
    /// 16.7 ms. Intervals are counted within this stretch only.
    pub fn run_desk(&mut self, desk: &DeskLoop, surfaces: &[&str], time: Duration) -> Frames {
        let mut frames = Frames::default();
        let until = Instant::now() + time;
        let mut last = None;
        while Instant::now() < until {
            if Instant::now() >= desk.next.get() {
                let start = Instant::now();
                let drew = self.compose(desk, surfaces);
                frames.work.push(start.elapsed());
                if let Some(last) = last {
                    frames.intervals.push(start - last);
                }
                let now = super::epoch_ms();
                frames.first.get_or_insert(now);
                if drew {
                    frames.first_with_surface.get_or_insert(now);
                }
                last = Some(start);
                desk.drawn(start);
            }
            self.step();
        }
        frames
    }

    /// Run the desk until `painted` holds and a frame has been composed after it, for at most
    /// `timeout`: when `painted` first held, and when that frame was done (GPU included). `painted`
    /// is asked right after CEF's work, before the wait, as the compositor window composes then.
    pub fn run_desk_until(
        &mut self,
        desk: &DeskLoop,
        surfaces: &[&str],
        timeout: Duration,
        painted: impl Fn(&Probe) -> bool,
    ) -> (Option<Instant>, Option<Instant>) {
        let until = Instant::now() + timeout;
        let mut painted_at = None;
        while Instant::now() < until {
            if Instant::now() >= desk.next.get() {
                let start = Instant::now();
                self.compose(desk, surfaces);
                desk.drawn(start);
                if painted_at.is_some_and(|at| start >= at) {
                    return (painted_at, Some(Instant::now()));
                }
            }
            let until = self.work();
            if painted_at.is_none() && painted(self) {
                painted_at = Some(Instant::now());
            }
            Probe::wait(until);
        }
        (painted_at, None)
    }

    /// One frame of the desk; whether it drew a surface's texture.
    fn compose(&mut self, desk: &DeskLoop, surfaces: &[&str]) -> bool {
        let mut composed = self.shared.lock();
        let ids: Vec<_> = surfaces
            .iter()
            .filter_map(|s| composed.texture_of(s))
            .collect();
        let mut scene = Scene::new(SIZE.0, SIZE.1);
        scene.set_wallpaper(Wallpaper::Solid(Color::hex(0x1d2333)));
        let columns = (surfaces.len() as f32).sqrt().ceil().max(1.0) as usize;
        let cell = SIZE.0 as f32 / columns as f32;
        for (i, id) in ids.iter().enumerate() {
            let (col, row) = ((i % columns) as f32, (i / columns) as f32);
            let rect = Rect::new(
                col * cell + 8.0,
                row * cell * 0.6 + 8.0,
                cell - 16.0,
                cell * 0.6 - 16.0,
            );
            let _ = scene.insert(scene.root(), SurfaceNode::new(rect, *id));
        }
        composed.compositor.invalidate();
        let stats = composed.compositor.render(&scene, &desk.target.view, SIZE);
        let device = composed.compositor.device().clone();
        drop(composed);
        let _ = device.poll(wgpu::PollType::wait_indefinitely());
        stats.drawn && stats.nodes_drawn > stats.missing_textures && !ids.is_empty()
    }
}

/// This process's descendants with their kind (`--type=` of a CEF subprocess), parents first.
pub fn tree() -> Vec<(u32, String)> {
    let Ok(out) = std::process::Command::new("ps")
        .args(["-ax", "-o", "pid=,ppid=,command="])
        .output()
    else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let rows: Vec<(u32, u32, &str)> = text
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let pid = parts.next()?.parse().ok()?;
            let ppid = parts.next()?.parse().ok()?;
            Some((pid, ppid, line))
        })
        .collect();
    let mut tree = vec![(std::process::id(), "browser".to_owned())];
    let mut i = 0;
    while i < tree.len() {
        let parent = tree[i].0;
        for (pid, ppid, line) in &rows {
            if *ppid == parent && tree.iter().all(|(p, _)| p != pid) {
                let kind = line
                    .split_whitespace()
                    .find_map(|w| w.strip_prefix("--type="))
                    .unwrap_or("other");
                tree.push((*pid, kind.to_owned()));
            }
        }
        i += 1;
    }
    tree
}

/// The memory of `pids` in MiB, by pid, and the tool that read it: `footprint` (physical footprint,
/// what Activity Monitor shows and #35 measured) on macOS, RSS elsewhere.
pub fn memory(pids: &[u32]) -> (Vec<(u32, f64)>, &'static str) {
    if cfg!(target_os = "macos")
        && let Some(found) = footprint(pids)
    {
        return (found, "footprint");
    }
    let rss = pids
        .iter()
        .filter_map(|p| Some((*p, rss_mb(*p)?)))
        .collect();
    (rss, "rss")
}

fn footprint(pids: &[u32]) -> Option<Vec<(u32, f64)>> {
    let file =
        std::env::temp_dir().join(format!("desk-probe-footprint-{}.json", std::process::id()));
    let mut command = std::process::Command::new("footprint");
    command.arg("-j").arg(&file);
    command.args(pids.iter().map(u32::to_string));
    command
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    command.status().ok()?;
    let doc: Value = serde_json::from_slice(&std::fs::read(&file).ok()?).ok()?;
    let _ = std::fs::remove_file(&file);
    let unit = doc["bytes per unit"].as_f64().unwrap_or(1.0);
    let found = doc["processes"]
        .as_array()?
        .iter()
        .filter_map(|p| {
            let pid = u32::try_from(p["pid"].as_u64()?).ok()?;
            Some((pid, p["footprint"].as_f64()? * unit / (1024.0 * 1024.0)))
        })
        .collect();
    Some(found)
}

/// One process's resident set in MiB (Unix `ps`).
pub fn rss_mb(pid: u32) -> Option<f64> {
    ps_field(pid, "rss=").map(|kb| kb / 1024.0)
}

/// The CPU time one process has used, in seconds (Unix `ps -o time=`: `[[dd-]hh:]mm:ss[.ff]`).
pub fn cpu_seconds(pid: u32) -> Option<f64> {
    let text = ps_text(pid, "time=")?;
    let (days, clock) = text.split_once('-').unwrap_or(("0", &text));
    let seconds = clock.split(':').try_fold(0.0, |total: f64, part| {
        Some(total * 60.0 + part.parse::<f64>().ok()?)
    })?;
    Some(days.parse::<f64>().ok()? * 86_400.0 + seconds)
}

fn ps_field(pid: u32, field: &str) -> Option<f64> {
    ps_text(pid, field)?.parse().ok()
}

fn ps_text(pid: u32, field: &str) -> Option<String> {
    let out = std::process::Command::new("ps")
        .args(["-o", field, "-p", &pid.to_string()])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_owned();
    (!text.is_empty()).then_some(text)
}
