//! Development builds' look at the windows out of the canvas (#235), for the app e2e
//! (`e2e/specs/windows-out.spec.ts`): the machine running it may have its screen locked, where no
//! pointer reaches an OS window's red button or its title bar. `compositor_window { app }` answers
//! the OS windows the shell holds, each with its window, its plugin, its title and its frame, and
//! the titles the app's Window menu lists (`windowMenu`);
//! `{ app: "<window>", close: true }` first hands that window the OS's close request, as its red
//! button does, and `{ app: "<window>", frame }` first puts it at `frame`, as a drag and a resize
//! would. The answer is read before the event's work is done: a check waits on
//! `desk.windows.list`.

use std::sync::mpsc;
use std::time::Duration;

use serde_json::{Value, json};
use winit::application::ApplicationHandler;
use winit::event::WindowEvent;
use winit::event_loop::ActiveEventLoop;

use crate::host::Desk;
use crate::main_frame::Frame;
use crate::window::Shell;

/// What a check asks for.
#[derive(Clone, Debug, PartialEq)]
pub enum Ask {
    /// The OS windows the shell holds.
    List,
    /// Window `0`'s OS window is asked to close, as its red button asks.
    Close(String),
    /// Window `0`'s OS window moves to this frame.
    Frame(String, Frame),
}

impl Ask {
    /// What `args` ask for (`{ app: true }`, or `{ app: "<window>" }` with `close` or `frame`).
    pub fn parse(args: &Value) -> Result<Ask, String> {
        let Some(window) = args.get("app").and_then(Value::as_str) else {
            return Ok(Ask::List);
        };
        let window = window.to_owned();
        if args.get("close").and_then(Value::as_bool) == Some(true) {
            return Ok(Ask::Close(window));
        }
        match args.get("frame") {
            Some(frame) => serde_json::from_value(frame.clone())
                .map(|frame| Ask::Frame(window, frame))
                .map_err(|why| format!("not a frame: {why}")),
            None => Err("an app window's check asks to close it or names its frame".to_owned()),
        }
    }
}

/// The answer to `compositor_window { app }`.
pub fn answer(desk: &Desk, args: &Value) -> Result<Value, String> {
    let ask = Ask::parse(args)?;
    let (sent, answered) = mpsc::channel();
    desk.pump.run(move |shell, event_loop| {
        let _ = sent.send(run(shell, event_loop, ask));
    });
    answered
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "the app windows did not answer".to_owned())?
}

fn run(shell: &mut Shell, event_loop: &ActiveEventLoop, ask: Ask) -> Result<Value, String> {
    let os_window = |shell: &Shell, window: &str| {
        (shell.apps.surfaces().iter())
            .filter_map(|s| shell.apps.get(s))
            .find(|app| app.window == window)
            .map(|app| app.pane.window.clone())
            .ok_or_else(|| format!("{window} has no OS window"))
    };
    match ask {
        Ask::List => {}
        Ask::Close(window) => {
            let id = os_window(shell, &window)?.id();
            shell.window_event(event_loop, id, WindowEvent::CloseRequested);
        }
        Ask::Frame(window, frame) => {
            let os = os_window(shell, &window)?;
            crate::main_frame::set(&os, frame);
        }
    }
    let mut windows: Vec<Value> = (shell.apps.surfaces().iter())
        .filter_map(|s| shell.apps.get(s).map(|app| (s, app)))
        .map(|(surface, app)| {
            json!({
                "window": app.window,
                "plugin": app.plugin,
                "surface": surface,
                "title": app.pane.window.title(),
                "frame": crate::main_frame::frame_of(&app.pane.window),
                "browser": app.pane.browser.is_some(),
            })
        })
        .collect();
    windows.sort_by_key(|w| w["window"].as_str().map(str::to_owned));
    Ok(json!({ "windows": windows, "windowMenu": crate::menu::listed_windows() }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_check_lists_closes_or_moves_and_says_what_it_cannot_read() {
        assert_eq!(Ask::parse(&json!({ "app": true })), Ok(Ask::List));
        assert_eq!(
            Ask::parse(&json!({ "app": "e2e.hello", "close": true })),
            Ok(Ask::Close("e2e.hello".into()))
        );
        let frame = json!({ "x": 80.0, "y": 90.0, "width": 640.0, "height": 420.0 });
        let at = Frame {
            x: 80.0,
            y: 90.0,
            width: 640.0,
            height: 420.0,
        };
        assert_eq!(
            Ask::parse(&json!({ "app": "endue.notes@2", "frame": frame })),
            Ok(Ask::Frame("endue.notes@2".into(), at))
        );
        assert!(Ask::parse(&json!({ "app": "e2e.hello" })).is_err());
        assert!(Ask::parse(&json!({ "app": "e2e.hello", "frame": { "x": 1 } })).is_err());
    }
}
