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

use super::CompositorWindow;
use crate::frame_trace::{self, Timed};
use crate::host::Desk;
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
