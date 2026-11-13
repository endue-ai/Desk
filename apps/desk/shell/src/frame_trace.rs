//! The frame trace the motion gate reads (#247, ADR 0208): with `DESK_FRAME_TRACE=<file>` the desk
//! appends one JSON line per event, `{ t, e, f }`, `t` the milliseconds since the trace opened.
//! Events: `start` (the process, its pid and the wall clock), `move` and `button` (pointer input
//! heard), `report` (the desk's page published its desk), `attach` (a surface's paint copied, and how
//! long the copy took), `win` (a scene laid out: each window's place and whether it is drawn from its
//! own page or from parts of the desk's, and where each surface's texture is drawn), `frame` (a frame
//! composed and shown or rendered unseen, its parts timed), `capture` (a frame read back to a file),
//! `stall` (a page that stopped painting) and `shake` (the shake's phases, `compositor_window/
//! motion.rs`). Without the variable every call does nothing. The file is appended to, so a desk
//! that starts again (ADR 0202) writes on in the same file after a second `start`.

use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use desk_compositor::input::Input;
use serde_json::{Value, json};

struct Trace {
    out: std::io::BufWriter<std::fs::File>,
    origin: Instant,
}

static TRACE: OnceLock<Option<Mutex<Trace>>> = OnceLock::new();

fn trace() -> Option<&'static Mutex<Trace>> {
    TRACE
        .get_or_init(|| {
            let path = std::env::var_os("DESK_FRAME_TRACE")?;
            let file = (std::fs::OpenOptions::new().create(true).append(true))
                .open(path)
                .ok()?;
            let trace = Mutex::new(Trace {
                out: std::io::BufWriter::new(file),
                origin: Instant::now(),
            });
            let wall = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default();
            write(
                &trace,
                "start",
                json!({ "pid": std::process::id(), "wallMs": wall.as_millis() as u64 }),
            );
            Some(trace)
        })
        .as_ref()
}

fn write(trace: &Mutex<Trace>, event: &str, fields: Value) {
    let Ok(mut trace) = trace.lock() else { return };
    let t = trace.origin.elapsed().as_secs_f64() * 1000.0;
    let _ = writeln!(trace.out, "{}", json!({ "t": t, "e": event, "f": fields }));
    let _ = trace.out.flush();
}

/// Whether a trace is being written.
pub fn on() -> bool {
    trace().is_some()
}

/// One event with its fields.
pub fn line(event: &str, fields: Value) {
    if let Some(trace) = trace() {
        write(trace, event, fields);
    }
}

/// Milliseconds since `since`.
pub fn ms(since: Instant) -> f64 {
    since.elapsed().as_secs_f64() * 1000.0
}

static SHAKING: AtomicBool = AtomicBool::new(false);

/// A shake runs (or ended): meanwhile the window hears no pointer of the OS's, so a hand on the
/// real mouse does not move what is measured.
pub fn set_shaking(on: bool) {
    SHAKING.store(on, Ordering::Relaxed);
}

/// Whether `input`, from the OS, is a pointer event a running shake keeps from the window.
pub fn masks(input: &Input) -> bool {
    let pointer = matches!(
        input,
        Input::PointerMoved { .. } | Input::PointerButton { .. } | Input::PointerLeft
    );
    pointer && SHAKING.load(Ordering::Relaxed)
}

/// A pointer event the window heard.
pub fn input(input: &Input) {
    if !on() {
        return;
    }
    match input {
        Input::PointerMoved { x, y } => line("move", json!({ "x": x, "y": y })),
        Input::PointerButton { pressed, .. } => line("button", json!({ "pressed": pressed })),
        _ => {}
    }
}

/// A surface's paint copied into its texture, from `started`.
pub fn attached(surface: &str, started: Instant, damage: usize, ok: bool) {
    if on() {
        let copy = ms(started);
        line(
            "attach",
            json!({ "surface": surface, "copyMs": copy, "damage": damage, "ok": ok }),
        );
    }
}

/// A scene laid out: each window of `plan` where it is drawn, whether from its own page (ADR 0201)
/// or from `parts` of the desk's page (where the page's picture shows it, `page`), and where each
/// surface's texture is drawn (`placed`, logical pixels).
pub fn laid_out(plan: Option<&desk_wm::host::Plan>, placed: &[(String, desk_compositor::Rect)]) {
    if !on() {
        return;
    }
    let at = |r: desk_wm::Rect| json!([r.x, r.y, r.w, r.h]);
    let drawn = |surface: &str| placed.iter().find(|(s, _)| s == surface).map(|(_, r)| r);
    let windows: Vec<Value> = (plan
        .map(|p| p.windows.as_slice())
        .unwrap_or_default()
        .iter())
    .map(|w| {
        let own = crate::web_host::window_pages::surface_of(&w.id);
        json!({ "id": w.id, "rect": at(w.rect), "focused": w.focused,
                "own": drawn(&own).is_some(), "parts": w.page_parts.len(), "page": at(w.page) })
    })
    .collect();
    let surfaces: Vec<Value> = (placed.iter())
        .map(|(s, r)| json!([s, r.x, r.y, r.width, r.height]))
        .collect();
    line("win", json!({ "windows": windows, "surfaces": surfaces }));
}

/// One frame's times: from its start, the scene (laid out again, `laidOut`, or drawn as it was),
/// the swapchain image asked for, and the render with the present or, unseen, the render alone.
pub struct Timed(Option<(Instant, bool, Vec<f64>)>);

impl Timed {
    /// A frame starts; `laid_out` says whether its scene is laid out again.
    pub fn begin(laid_out: impl FnOnce() -> bool) -> Timed {
        Timed(on().then(|| (Instant::now(), laid_out(), Vec::new())))
    }

    /// The next part ended (the scene, then the image).
    pub fn mark(&mut self) {
        if let Some((started, _, marks)) = self.0.as_mut() {
            marks.push(ms(*started));
        }
    }

    /// The frame ended: frame `n` was `shown` in the window, or rendered unseen.
    pub fn end(self, n: u64, shown: bool) {
        let Some((started, laid_out, marks)) = self.0 else {
            return;
        };
        let (scene, image, render) = parts(ms(started), &marks);
        line(
            "frame",
            json!({ "n": n, "laidOut": laid_out, "shown": shown, "sceneMs": scene,
                "acquireMs": image, "presentMs": render, "tickMs": ms(started) }),
        );
    }
}

/// A frame's parts from its `total` and the ends of its parts (`marks`): the scene, the image
/// asked for and the render; a part not reached took nothing.
fn parts(total: f64, marks: &[f64]) -> (f64, f64, f64) {
    let scene = marks.first().copied().unwrap_or(total);
    let image = marks.get(1).copied().unwrap_or(scene);
    (scene, image - scene, total - image)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_frames_time_splits_into_its_scene_its_image_and_its_render() {
        assert_eq!(parts(10.0, &[2.0, 5.0]), (2.0, 3.0, 5.0));
        assert_eq!(
            parts(10.0, &[2.0]),
            (2.0, 0.0, 8.0),
            "unseen: no image asked for"
        );
        assert_eq!(parts(10.0, &[]), (10.0, 0.0, 0.0));
    }

    #[test]
    fn a_shake_masks_the_oss_pointer_and_nothing_else() {
        let moved = Input::PointerMoved { x: 1.0, y: 2.0 };
        assert!(!masks(&moved), "no shake: the OS's pointer is heard");
        set_shaking(true);
        assert!(masks(&moved));
        assert!(masks(&Input::PointerLeft));
        assert!(!masks(&Input::WindowFocused { focused: true }));
        set_shaking(false);
        assert!(!masks(&moved));
    }
}
