//! The main window's frame across starts (issue 163, finding 9). Where the window was and how large
//! is kept in `<data>/desk-window.json` once it rests after a move or a resize, and when the desk
//! quits; the next start opens it there when a display still shows its title bar, else at the size
//! kept wherever the OS puts a new window, never smaller than the least size nor larger than the
//! display. A window in full screen, minimized or hidden keeps the frame it had before. Logical
//! pixels (points on macOS) of the desktop's global space; on macOS the place is the content's
//! top-left corner under the title bar, where winit opens a window, elsewhere the frame's.

use std::path::PathBuf;
use std::sync::mpsc::{self, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use desk_web::sender::Role;
use serde::{Deserialize, Serialize};
use winit::dpi::{LogicalPosition, LogicalSize};
use winit::event_loop::ActiveEventLoop;
use winit::monitor::MonitorHandle;
use winit::window::{Window, WindowAttributes};

use crate::pump::Pump;
use crate::window::Shell;

const FILE: &str = "desk-window.json";
/// The least size of the main window (`window.rs`).
pub const LEAST: (f64, f64) = (1024.0, 500.0);
/// A display shows a window's title bar when this much of the window's top strip lies on it.
const REACH: f64 = 120.0;
const STRIP: f64 = 24.0;
/// A drag or a resize moves the window many times a second: the frame is kept once it rests.
const REST: Duration = Duration::from_millis(500);

/// A window's place and size, or a display's work area.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// How the next start opens the window: at `at` when a display shows it there, at `size`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Opening {
    pub at: Option<(f64, f64)>,
    pub size: (f64, f64),
}

impl Frame {
    /// A kept file's frame; one that cannot be read, or is no frame, keeps none.
    pub fn parse(text: &str) -> Option<Self> {
        let frame: Self = serde_json::from_str(text).ok()?;
        let finite = [frame.x, frame.y, frame.width, frame.height]
            .iter()
            .all(|v| v.is_finite());
        (finite && frame.width > 0.0 && frame.height > 0.0).then_some(frame)
    }

    /// How a window kept at this frame opens on `displays` (their work areas, the primary first).
    pub fn opening(self, displays: &[Frame]) -> Opening {
        let shows = displays.iter().find(|d| self.shown_on(d));
        let within = shows.or(displays.first());
        let fit = |kept: f64, least: f64, room: Option<f64>| {
            kept.max(least).min(room.unwrap_or(f64::MAX).max(least))
        };
        Opening {
            at: shows.map(|d| (self.x, self.y.max(d.y))),
            size: (
                fit(self.width, LEAST.0, within.map(|d| d.width)),
                fit(self.height, LEAST.1, within.map(|d| d.height)),
            ),
        }
    }

    /// Whether display `d` shows enough of the window's top strip for the person to reach it.
    fn shown_on(self, d: &Frame) -> bool {
        let across = (self.x + self.width).min(d.x + d.width) - self.x.max(d.x);
        let down = self.y >= d.y - STRIP && self.y + STRIP <= d.y + d.height;
        across >= REACH.min(self.width) && down
    }
}

struct Keeper {
    nudge: Sender<()>,
    /// What the file holds now.
    kept: Mutex<Option<Frame>>,
}

static KEEPER: OnceLock<Keeper> = OnceLock::new();

fn file() -> PathBuf {
    crate::paths::data_dir().join(FILE)
}

/// The main window's `attributes` at the frame kept, if one; from now on the frame is kept.
pub fn opened(
    event_loop: &ActiveEventLoop,
    pump: &Pump,
    attributes: WindowAttributes,
) -> WindowAttributes {
    let kept = std::fs::read_to_string(file())
        .ok()
        .and_then(|text| Frame::parse(&text));
    let pump = pump.clone();
    KEEPER.get_or_init(|| Keeper {
        nudge: debounce(move || pump.run(|shell, _| keep(shell))),
        kept: Mutex::new(kept),
    });
    let Some(kept) = kept else {
        return attributes;
    };
    let opening = kept.opening(&displays(event_loop));
    let attributes = attributes.with_inner_size(LogicalSize::new(opening.size.0, opening.size.1));
    match opening.at {
        Some((x, y)) => attributes.with_position(LogicalPosition::new(x, y)),
        None => attributes,
    }
}

/// The main window moved or resized: its frame is kept once it rests.
pub fn moved() {
    if let Some(keeper) = KEEPER.get() {
        let _ = keeper.nudge.send(());
    }
}

/// Keep the main window's frame now: it rested, or the desk quits.
pub fn keep(shell: &Shell) {
    let (Some(keeper), Some(main)) = (KEEPER.get(), shell.pane(Role::Main)) else {
        return;
    };
    let Some(frame) = frame_of(&main.window) else {
        return;
    };
    let mut kept = keeper
        .kept
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if *kept == Some(frame) {
        return;
    }
    let path = file();
    let text = serde_json::to_string_pretty(&frame).unwrap_or_default();
    let saved = path
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|()| {
            let partial = path.with_extension("json.partial");
            std::fs::write(&partial, text).and_then(|()| std::fs::rename(&partial, &path))
        });
    match saved {
        Ok(()) => *kept = Some(frame),
        Err(why) => eprintln!(
            "endue Desk: the window's frame was not kept in {} ({why})",
            path.display()
        ),
    }
}

/// The window's frame as kept; none while it is in full screen, minimized or hidden.
pub fn frame_of(window: &Window) -> Option<Frame> {
    let away = window.fullscreen().is_some()
        || window.is_minimized() == Some(true)
        || window.is_visible() == Some(false);
    if away {
        return None;
    }
    let scale = window.scale_factor();
    let at = place_of(window)?.to_logical::<f64>(scale);
    let size = window.inner_size().to_logical::<f64>(scale);
    Some(Frame {
        x: at.x.round(),
        y: at.y.round(),
        width: size.width.round(),
        height: size.height.round(),
    })
}

/// Put the window at `frame`, as a person's drag and resize would (the e2e's `compositor_window`).
pub fn set(window: &Window, frame: Frame) {
    let scale = window.scale_factor();
    let _ = window.request_inner_size(LogicalSize::new(frame.width, frame.height));
    // The frame's corner is where the place is, less what lies above it (the title bar on macOS).
    let (Some(place), Ok(outer)) = (place_of(window), window.outer_position()) else {
        return;
    };
    let (place, outer) = (
        place.to_logical::<f64>(scale),
        outer.to_logical::<f64>(scale),
    );
    window.set_outer_position(LogicalPosition::new(
        frame.x + outer.x - place.x,
        frame.y + outer.y - place.y,
    ));
}

fn place_of(window: &Window) -> Option<winit::dpi::PhysicalPosition<i32>> {
    if cfg!(target_os = "macos") {
        window.inner_position().ok()
    } else {
        window.outer_position().ok()
    }
}

/// The displays' work areas in logical pixels, the primary one first.
fn displays(event_loop: &ActiveEventLoop) -> Vec<Frame> {
    let primary = event_loop.primary_monitor();
    let others = event_loop
        .available_monitors()
        .filter(|m| Some(m) != primary.as_ref());
    let all: Vec<MonitorHandle> = primary.clone().into_iter().chain(others).collect();
    all.iter()
        .map(|monitor| {
            let area = crate::displays::work_area(monitor);
            let scale = monitor.scale_factor();
            Frame {
                x: f64::from(area.x) / scale,
                y: f64::from(area.y) / scale,
                width: f64::from(area.width) / scale,
                height: f64::from(area.height) / scale,
            }
        })
        .collect()
}

/// Run `run` once `REST` has passed without another nudge, on a thread of its own.
fn debounce(run: impl Fn() + Send + 'static) -> Sender<()> {
    let (nudge, nudged) = mpsc::channel::<()>();
    let spawned = std::thread::Builder::new()
        .name("desk-main-frame".to_owned())
        .spawn(move || {
            while nudged.recv().is_ok() {
                while nudged.recv_timeout(REST).is_ok() {}
                run();
            }
        });
    if let Err(why) = spawned {
        eprintln!("endue Desk: the window's frame is not kept ({why})");
    }
    nudge
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1728×1080-point display with a 33-point menu bar and its second screen to the right.
    const MAIN: Frame = Frame {
        x: 0.0,
        y: 33.0,
        width: 1728.0,
        height: 1047.0,
    };
    const RIGHT: Frame = Frame {
        x: 1728.0,
        y: 0.0,
        width: 1920.0,
        height: 1080.0,
    };

    fn frame(x: f64, y: f64, width: f64, height: f64) -> Frame {
        Frame {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn a_kept_frame_on_a_display_opens_where_and_as_large_as_it_was() {
        let kept = frame(200.0, 120.0, 1340.0, 900.0);
        let opening = kept.opening(&[MAIN, RIGHT]);
        assert_eq!(opening.at, Some((200.0, 120.0)));
        assert_eq!(opening.size, (1340.0, 900.0));
        // On the second display too.
        let there = frame(2200.0, 500.0, 1100.0, 560.0).opening(&[MAIN, RIGHT]);
        assert_eq!(there.at, Some((2200.0, 500.0)));
    }

    #[test]
    fn a_frame_no_display_shows_opens_where_the_os_puts_it_at_its_size_within_the_primary() {
        // The second display is gone: the window was on it.
        let gone = frame(2200.0, 500.0, 1340.0, 900.0).opening(&[MAIN]);
        assert_eq!(gone.at, None);
        assert_eq!(gone.size, (1340.0, 900.0));
        // Only a sliver of the title bar would be on screen.
        let sliver = frame(1650.0, 100.0, 1280.0, 800.0).opening(&[MAIN]);
        assert_eq!(sliver.at, None);
        // A title bar under the bottom edge is out of reach, one above the top comes down.
        assert_eq!(
            frame(100.0, 1070.0, 1280.0, 800.0).opening(&[MAIN]).at,
            None
        );
        assert_eq!(
            frame(100.0, 20.0, 1280.0, 800.0).opening(&[MAIN]).at,
            Some((100.0, 33.0))
        );
    }

    #[test]
    fn the_size_stays_between_the_least_size_and_the_display() {
        let small = frame(100.0, 100.0, 300.0, 200.0).opening(&[MAIN]);
        assert_eq!(small.size, LEAST);
        let large = frame(0.0, 40.0, 4000.0, 3000.0).opening(&[MAIN]);
        assert_eq!(large.size, (1728.0, 1047.0));
        // No display known: the kept size, not below the least.
        assert_eq!(
            frame(0.0, 0.0, 900.0, 800.0).opening(&[]).size,
            (1024.0, 800.0)
        );
    }

    #[test]
    fn a_kept_file_that_holds_no_frame_keeps_none() {
        let text = r#"{ "x": 10, "y": 20, "width": 1300, "height": 820 }"#;
        assert_eq!(Frame::parse(text), Some(frame(10.0, 20.0, 1300.0, 820.0)));
        for broken in [
            "",
            "not json",
            r#"{ "x": 10, "y": 20 }"#,
            r#"{ "x": 10, "y": 20, "width": 0, "height": 820 }"#,
            r#"{ "x": 10, "y": 20, "width": -5, "height": 820 }"#,
        ] {
            assert_eq!(Frame::parse(broken), None, "{broken}");
        }
    }
}
