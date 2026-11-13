//! The motion gate's parts in the compositor window (#247, ADR 0208, development builds): the shake
//! and a frame rendered unseen.
//!
//! The shake (`compositor_input { shake }`) presses a window's title bar at `x`, `y` (logical
//! pixels) and swings the pointer left and right on a sine (`amp` pixels, `periodMs`) for
//! `durationMs`, one move every `stepMs` from a thread of its own, each arriving through the event
//! loop as an OS event does, then releases it `drop` pixels from where it was pressed. It can read
//! the composed frame back at rest before the swing (`rest`), at moments of the swing (`captures`,
//! `{ atMs, path }`) and after the release (`dropped`); `tag` names it in the trace. The OS's pointer is masked meanwhile
//! (`frame_trace::masks`), and the frame trace says when each phase began.
//!
//! The sway (`compositor_window { sway }`, #258) grows and shrinks the app window itself around a
//! middle size on two sines, `ampW` points wide over `periodMs` and `ampH` high over `periodHMs`,
//! a new frame every `stepMs` for `durationMs` after `delayMs`, each set from a thread of its own
//! through the event loop as `compositor_window { frame }` sets it, its top-left corner kept; then it
//! ends `ampW / 2` and `ampH / 2` past the middle, so the desk rests at a size it did not start at.
//! The middle is the window's size, grown where the swing would take it under its least size. A
//! person's live resize reaches the shell the same way: winit reports AppKit's frame change as
//! `Resized` (`frameDidChange:`), live or not, and the shell does nothing else for a live resize.
//!
//! A frame the window does not present (headless, `DESK_COMPOSITOR_HEADLESS=1`) is rendered off
//! screen while a frame trace runs, the window's size, so its GPU work counts as a shown frame's
//! does and the gate needs no screen to show it on (a locked one, a covered window).

use std::cell::RefCell;
use std::f64::consts::TAU;
use std::sync::mpsc;
use std::thread::sleep;
use std::time::{Duration, Instant};

use desk_compositor::headless::Target;
use desk_compositor::input::{Button, Input};
use serde_json::{Value, json};

use desk_web::sender::Role;

use super::CompositorWindow;
use crate::frame_trace::{self, Timed};
use crate::host::Desk;
use crate::main_frame::{self, Frame, LEAST};
use crate::pump::Pump;

thread_local! {
    /// The target unseen frames are rendered into, the window's size.
    static UNSEEN: RefCell<Option<Target>> = const { RefCell::new(None) };
}

impl CompositorWindow {
    /// A frame composed and not presented: rendered off screen while a trace runs, after the last
    /// one finished (one frame in flight, as a swapchain keeps a frame or two).
    pub(super) fn unseen(&mut self, mut timed: Timed) {
        if !frame_trace::on() {
            return;
        }
        timed.mark();
        let size = self.scene.viewport();
        let mut composed = self.shared.lock();
        let device = composed.compositor.device().clone();
        let _ = device.poll(wgpu::PollType::wait_indefinitely());
        UNSEEN.with(|target| {
            let mut target = target.borrow_mut();
            if target.as_ref().is_none_or(|t| t.size != size) {
                *target = Some(Target::new(&device, size, composed.compositor.format()));
            }
            if let Some(target) = target.as_ref() {
                composed.compositor.invalidate();
                composed.compositor.render(&self.scene, &target.view, size);
            }
        });
        drop(composed);
        timed.end(self.composed, false);
    }
}

/// A capture the shake asks for at `atMs` into its swing.
struct Capture {
    at: f64,
    path: String,
}

/// Start the shake `args.shake` describes; it runs on a thread of its own.
pub fn shake(desk: &Desk, args: &Value) -> Result<Value, String> {
    let shake = args.get("shake").cloned().unwrap_or_default();
    let num = |k: &str, d: f64| shake.get(k).and_then(Value::as_f64).unwrap_or(d);
    let text = |k: &str| shake.get(k).and_then(Value::as_str).map(str::to_owned);
    let (x, y, amp) = (num("x", 0.0), num("y", 0.0), num("amp", 200.0));
    let (period, duration) = (num("periodMs", 500.0).max(1.0), num("durationMs", 3000.0));
    let step = num("stepMs", 8.0).max(1.0);
    let drop = shake.get("drop").and_then(Value::as_array);
    let off = |i: usize| {
        drop.and_then(|d| d.get(i))
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
    };
    let (dx, dy) = (off(0), off(1));
    let (rest, dropped, tag) = (text("rest"), text("dropped"), text("tag"));
    let mut captures: Vec<Capture> = (shake.get("captures").and_then(Value::as_array))
        .map(|all| {
            (all.iter())
                .filter_map(|c| {
                    let at = c.get("atMs")?.as_f64()?;
                    let path = c.get("path")?.as_str()?.to_owned();
                    Some(Capture { at, path })
                })
                .collect()
        })
        .unwrap_or_default();
    captures.sort_by(|a, b| a.at.total_cmp(&b.at));
    let pump = desk.pump.clone();
    std::thread::spawn(move || {
        let feed = |event: Input| feed(&pump, event);
        let at = |x: f64, y: f64| Input::PointerMoved {
            x: x as f32,
            y: y as f32,
        };
        let button = |pressed| Input::PointerButton {
            button: Button::Left,
            pressed,
        };
        frame_trace::set_shaking(true);
        frame_trace::line(
            "shake",
            json!({ "phase": "press", "tag": tag, "x": x, "y": y }),
        );
        sleep(Duration::from_millis(40));
        feed(at(x, y));
        sleep(Duration::from_millis(60));
        feed(button(true));
        sleep(Duration::from_millis(300));
        if let Some(path) = rest {
            capture(&pump, path, "rest", true);
        }
        sleep(Duration::from_millis(100));
        frame_trace::line("shake", json!({ "phase": "swing", "on": true }));
        let started = Instant::now();
        let mut next = captures.into_iter().peekable();
        loop {
            let t = started.elapsed().as_secs_f64() * 1000.0;
            if t >= duration {
                break;
            }
            feed(at(x + amp * (TAU * t / period).sin(), y));
            if let Some(c) = next.next_if(|c| c.at <= t) {
                capture(&pump, c.path, "swing", false);
            }
            sleep(Duration::from_secs_f64(step / 1000.0));
        }
        frame_trace::line("shake", json!({ "phase": "swing", "on": false }));
        feed(at(x + dx, y + dy));
        sleep(Duration::from_millis(100));
        feed(button(false));
        frame_trace::line(
            "shake",
            json!({ "phase": "release", "x": x + dx, "y": y + dy }),
        );
        // The glide and the snap preview end within half a second (ADR 0128).
        sleep(Duration::from_millis(900));
        if let Some(path) = dropped {
            capture(&pump, path, "dropped", true);
        }
        frame_trace::set_shaking(false);
        frame_trace::line("shake", json!({ "phase": "done" }));
    });
    Ok(Value::Null)
}

/// `event` to the compositor window as winit's events reach it, its positions logical pixels.
fn feed(pump: &Pump, event: Input) {
    pump.run(move |shell, event_loop| {
        let Some(c) = shell.compositor.as_mut() else {
            return;
        };
        let scale = c.window.scale_factor() as f32;
        let event = match event {
            Input::PointerMoved { x, y } => Input::PointerMoved {
                x: x * scale,
                y: y * scale,
            },
            other => other,
        };
        c.input(event_loop, event);
    });
}

/// The composed frame read back to `path` on the event loop, waited for when `wait`.
fn capture(pump: &Pump, path: String, tag: &'static str, wait: bool) {
    let (sent, got) = mpsc::channel();
    pump.run(move |shell, _| {
        if let Some(c) = shell.compositor.as_mut() {
            let started = Instant::now();
            let answer = c.capture(&path);
            let ms = frame_trace::ms(started);
            let ok = answer.is_ok();
            frame_trace::line(
                "capture",
                json!({ "tag": tag, "path": path, "ms": ms, "ok": ok }),
            );
        }
        let _ = sent.send(());
    });
    if wait {
        let _ = got.recv_timeout(Duration::from_secs(10));
    }
}

/// A sway's swing: `amp` points wide and high, over `periods` milliseconds each.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Swing {
    amp: (f64, f64),
    periods: (f64, f64),
}

impl Swing {
    /// The middle a sway from `base` swings around: `base`, grown where the swing would take the
    /// window under its least size; and where it ends, half a swing past the middle.
    fn span(self, base: Frame) -> (Frame, Frame) {
        let (w, h) = self.amp;
        let mid = Frame {
            width: base.width.max(LEAST.0 + w),
            height: base.height.max(LEAST.1 + h),
            ..base
        };
        (mid, Self::grown(mid, w / 2.0, h / 2.0))
    }

    /// The frame `t` milliseconds into the sway around `mid`, in whole points.
    fn at(self, mid: Frame, t: f64) -> Frame {
        let ((w, h), (pw, ph)) = (self.amp, self.periods);
        let dw = (w * (TAU * t / pw).sin()).round();
        let dh = (h * (TAU * t / ph).sin()).round();
        Self::grown(mid, dw, dh)
    }

    fn grown(f: Frame, dw: f64, dh: f64) -> Frame {
        Frame {
            width: f.width + dw,
            height: f.height + dh,
            ..f
        }
    }
}

/// Start the sway `args.sway` describes; it runs on a thread of its own. It answers the window's
/// frame before, the middle it sways around and where it ends.
pub fn sway(desk: &Desk, args: &Value) -> Result<Value, String> {
    let sway = args.get("sway").cloned().unwrap_or_default();
    let num = |k: &str, d: f64| sway.get(k).and_then(Value::as_f64).unwrap_or(d);
    let swing = Swing {
        amp: (num("ampW", 300.0).abs(), num("ampH", 200.0).abs()),
        periods: (
            num("periodMs", 800.0).max(1.0),
            num("periodHMs", 1000.0).max(1.0),
        ),
    };
    let (step, duration) = (num("stepMs", 8.0).max(1.0), num("durationMs", 4000.0));
    let wait = num("delayMs", 0.0).max(0.0);
    let tag = sway.get("tag").and_then(Value::as_str).map(str::to_owned);
    let pump = desk.pump.clone();
    let (sent, got) = mpsc::channel();
    pump.run(move |shell, _| {
        let frame = shell
            .pane(Role::Main)
            .and_then(|m| main_frame::frame_of(&m.window));
        let _ = sent.send(frame);
    });
    let base = (got.recv_timeout(Duration::from_secs(10)).ok().flatten())
        .ok_or("the main window has no frame to sway (hidden, minimized or full screen)")?;
    let (mid, end) = swing.span(base);
    std::thread::spawn(move || {
        sleep(Duration::from_secs_f64(wait / 1000.0));
        let size = |f: Frame| json!([f.width, f.height]);
        frame_trace::line(
            "sway",
            json!({ "phase": "start", "tag": tag, "from": size(base), "mid": size(mid) }),
        );
        let started = Instant::now();
        loop {
            let t = started.elapsed().as_secs_f64() * 1000.0;
            if t >= duration {
                break;
            }
            set_frame(&pump, swing.at(mid, t));
            sleep(Duration::from_secs_f64(step / 1000.0));
        }
        set_frame(&pump, end);
        frame_trace::line("sway", json!({ "phase": "end", "to": size(end) }));
    });
    Ok(json!({ "from": base, "mid": mid, "to": end }))
}

/// The main window's frame set to `frame` on the event loop, as `compositor_window { frame }` does.
fn set_frame(pump: &Pump, frame: Frame) {
    pump.run(move |shell, _| {
        if let Some(main) = shell.pane(Role::Main) {
            main_frame::set(&main.window, frame);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const SWING: Swing = Swing {
        amp: (300.0, 200.0),
        periods: (700.0, 1000.0),
    };

    fn frame(width: f64, height: f64) -> Frame {
        Frame {
            x: 10.0,
            y: 20.0,
            width,
            height,
        }
    }

    #[test]
    fn a_sway_swings_around_a_middle_its_least_size_allows_and_ends_past_it() {
        let (mid, end) = SWING.span(frame(1280.0, 800.0));
        assert_eq!(
            mid,
            frame(LEAST.0 + 300.0, 800.0),
            "grown to swing 300 narrower"
        );
        assert_eq!(
            end,
            frame(mid.width + 150.0, 900.0),
            "half a swing past the middle"
        );
        let (big, _) = SWING.span(frame(1800.0, 1100.0));
        assert_eq!(
            big,
            frame(1800.0, 1100.0),
            "a large window sways around its own size"
        );
    }

    #[test]
    fn a_sway_is_on_two_sines_in_whole_points_its_corner_kept() {
        let mid = frame(1400.0, 900.0);
        assert_eq!(SWING.at(mid, 0.0), mid);
        assert_eq!(
            SWING.at(mid, 175.0),
            frame(1700.0, 900.0 + (200.0 * (TAU * 0.175).sin()).round())
        );
        let low = SWING.at(mid, 525.0);
        assert_eq!(
            low.width, 1100.0,
            "three quarters into its period, the narrowest"
        );
        assert_eq!((low.x, low.y), (10.0, 20.0));
        assert_eq!(SWING.at(mid, 250.0).height.fract(), 0.0);
    }
}
