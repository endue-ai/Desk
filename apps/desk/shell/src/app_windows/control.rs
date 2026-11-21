//! The desk moves an app window (ADR 0294): `app_window { window, ask }`, which only the desk's
//! own page may call, is how `desk.windows.move`, `resize`, `fill` and `pin` reach the OS window a
//! window popped out into, as the person's drag, resize and zoom would. `frames.rs` plans where it
//! goes; this puts it there on the event loop, remembers the fill it is in and whether it stays
//! above other windows, and answers where it is now, in points, with its display's work area. Its
//! frame goes back to the window manager as after any move (`OutFrame`, once it rests).

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock, mpsc};
use std::time::Duration;

use desk_wm::Rect;
use serde_json::{Value, json};
use winit::event_loop::ActiveEventLoop;
use winit::window::WindowLevel;

use super::frames::{self, Ask, Filled, Limits};
use crate::host::Desk;
use crate::main_frame::Frame;
use crate::window::Shell;

/// What the desk did to each app window that the OS does not say back: its fill and its pin.
#[derive(Default)]
struct Kept {
    filled: HashMap<String, Filled>,
    pinned: HashSet<String>,
}

fn kept() -> std::sync::MutexGuard<'static, Kept> {
    static ONCE: OnceLock<Mutex<Kept>> = OnceLock::new();
    let kept = ONCE.get_or_init(Mutex::default);
    kept.lock().unwrap_or_else(|e| e.into_inner())
}

/// Window `window`'s OS window opened afresh: no fill and no pin of an earlier one holds.
pub fn forget(window: &str) {
    let mut kept = kept();
    kept.filled.remove(window);
    kept.pinned.remove(window);
}

/// The answer to `app_window { window, ask }`.
pub fn answer(desk: &Desk, args: &Value) -> Result<Value, String> {
    let window = (args.get("window").and_then(Value::as_str))
        .ok_or("app_window names its window")?
        .to_owned();
    let ask: Ask = serde_json::from_value(args.get("ask").cloned().unwrap_or_default())
        .map_err(|why| format!("not an app window's ask: {why}"))?;
    let (sent, answered) = mpsc::channel();
    desk.pump.run(move |shell, event_loop| {
        let _ = sent.send(run(shell, event_loop, &window, &ask));
    });
    answered
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "the app windows did not answer".to_owned())?
}

const fn rect(f: Frame) -> Rect {
    Rect::new(f.x, f.y, f.width, f.height)
}

/// Every display's work area, in points.
fn areas(event_loop: &ActiveEventLoop) -> Vec<Rect> {
    (event_loop.available_monitors())
        .map(|monitor| {
            let area = crate::displays::work_area(&monitor);
            let scale = monitor.scale_factor();
            Rect::new(
                f64::from(area.x) / scale,
                f64::from(area.y) / scale,
                f64::from(area.width) / scale,
                f64::from(area.height) / scale,
            )
        })
        .collect()
}

fn run(
    shell: &mut Shell,
    event_loop: &ActiveEventLoop,
    window: &str,
    ask: &Ask,
) -> Result<Value, String> {
    let app = (shell.apps.surfaces().iter())
        .filter_map(|s| shell.apps.get(s))
        .find(|app| app.window == window)
        .ok_or_else(|| format!("{window} has no OS window open"))?;
    let os = app.pane.window.clone();
    let now = crate::main_frame::frame_of(&os).map(rect).ok_or_else(|| {
        format!(
            "{window}'s OS window is minimized or in full screen: desk.windows.focus brings it back"
        )
    })?;
    let hints =
        super::app(super::plugin_of(&app.plugin)).map_or_else(super::Hints::default, |a| a.hints());
    let limits = Limits {
        least: hints.least(),
        fixed: hints.fixed,
    };
    let mut kept = kept();
    let filled = kept.filled.get(window).copied();
    let plan = frames::plan(now, &areas(event_loop), ask, limits, filled)?;
    if plan.frame != now {
        let Rect { x, y, w, h } = plan.frame;
        crate::main_frame::set(
            &os,
            Frame {
                x,
                y,
                width: w,
                height: h,
            },
        );
    }
    match plan.filled {
        Some(f) => kept.filled.insert(window.to_owned(), f),
        None => kept.filled.remove(window),
    };
    if let Ask::Pin { pinned } = ask {
        let level = if *pinned {
            WindowLevel::AlwaysOnTop
        } else {
            WindowLevel::Normal
        };
        os.set_window_level(level);
        if *pinned {
            kept.pinned.insert(window.to_owned());
        } else {
            kept.pinned.remove(window);
        }
    }
    let Rect { x, y, w, h } = plan.frame;
    let s = plan.screen;
    let mut answer = json!({
        "x": x, "y": y, "w": w, "h": h,
        "pinned": kept.pinned.contains(window),
        "screen": { "x": s.x, "y": s.y, "w": s.w, "h": s.h },
    });
    if let Some(f) = plan.filled {
        answer["fill"] = json!(f.fill);
    }
    Ok(answer)
}
