//! The island (ADR 0204): one small surface over every app, closed with what is going on and open
//! where the person answers. A floating window (`float.rs`) on every Space and full-screen Space,
//! out of window cycling, made a non-activating panel on macOS (`panel`), so the app in front keeps
//! the keys until the person presses it. Its page (`index.html?view=island`) calls the core as the
//! desk for what it shows (`desk_web::sender`). This file opens the window the first time
//! `desk.island.show` is on and shows or hides it as the setting changes; `frame` places it, grows it
//! open and folds it, and keeps its spot per display (`kept`) in `<data>/island.json`; `screens`
//! hears a display come or go. Option+Enter opens it on Eris's field with the keys (`summon`), and
//! the floating Eris stays down while it shows.

pub mod commands;
mod frame;
pub mod kept;
pub mod panel;
mod screens;
#[cfg(test)]
mod tests;

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering::Relaxed};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use desk_bridge::BridgeEvent;
use desk_core::Core;
use desk_web::sender::Role;
use serde_json::json;
use winit::event_loop::ActiveEventLoop;

use crate::eris_window::calls::call;
use crate::eris_window::debounce;
use crate::eris_window::place::Rect;
use crate::float::{self, Spaces};
use crate::host::Desk;
use crate::window::Shell;
use kept::Kept;

/// Whose settings `show` is: `desk.island.show` (`plugins/island`).
const OWNER: &str = "desk.island";
const FILE: &str = "island.json";
/// The window closed (the pill and room for its shadow) and open, in logical pixels.
const CLOSED: (f64, f64) = (320.0, 64.0);
const OPEN: (f64, f64) = (380.0, 460.0);
/// How tall the page may ask it to be open (`island_fit`), in logical pixels.
const TALLEST: f64 = 640.0;
/// How far below the top of the work area it sits when no spot is kept, in logical pixels.
const MARGIN: f64 = 6.0;
/// A drag moves the window many times a second: keep where it ended once it has rested.
const REST: Duration = Duration::from_millis(500);
/// Displays come and go in bursts (a begin and an end for each): place it once they have settled.
const SETTLE: Duration = Duration::from_millis(400);

pub struct Island {
    core: Arc<Core>,
    kept: Mutex<Kept>,
    /// Where it was, closed, before it grew open.
    folded: Mutex<Option<Rect>>,
    /// Where the shell last put it: the move that follows is the shell's, not the person's.
    placed: Mutex<Option<Rect>>,
    open: AtomicBool,
    /// How tall it is open, in logical pixels: as tall as what its page shows (`island_fit`).
    height: AtomicU32,
    /// The person dragged it since it opened.
    dragged: AtomicBool,
    keep: Sender<()>,
    displays: Sender<()>,
}

/// Make the island's state and follow `desk.island.show`; the window opens the first time it is on.
pub fn setup(shell: &mut Shell, event_loop: &ActiveEventLoop) {
    let core = Arc::clone(&shell.desk.core);
    let file = crate::paths::data_dir().join(FILE);
    let kept = std::fs::read_to_string(&file)
        .map(|text| Kept::parse(&text))
        .unwrap_or_default();
    let pump = shell.desk.pump.clone();
    let island = Arc::new_cyclic(|this: &std::sync::Weak<Island>| {
        let this = this.clone();
        Island {
            core,
            kept: Mutex::new(kept),
            folded: Mutex::default(),
            placed: Mutex::default(),
            open: AtomicBool::new(false),
            height: AtomicU32::new(OPEN.1 as u32),
            dragged: AtomicBool::new(false),
            keep: debounce("desk-island-keep", REST, move || {
                if let Some(state) = this.upgrade() {
                    frame::keep(&state, &file);
                }
            }),
            displays: debounce("desk-island-displays", SETTLE, move || {
                pump.run(|shell, _| displays_changed(shell));
            }),
        }
    });
    let _ = shell.desk.island.set(Arc::clone(&island));
    screens::listen(island.displays.clone());
    if let Err(why) = watch(&shell.desk) {
        eprintln!("island: desk.island.show is not followed ({why})");
    }
    follow(shell, event_loop);
}

/// Show the island while `desk.island.show` is on, opening its window the first time; else hide it.
fn follow(shell: &mut Shell, event_loop: &ActiveEventLoop) {
    let Some(state) = shell.desk.island.get().cloned() else {
        return;
    };
    // The floating Eris stays down while the island shows (`eris_window::calls::mode`).
    crate::eris_window::main_changed(shell);
    if !shown(&state.core) {
        frame::hide(shell, &state);
        return;
    }
    if shell.pane(Role::Island).is_none() && !open_window(shell, event_loop) {
        return;
    }
    frame::show(shell, &state);
}

/// Option+Enter and the tray's Talk to Eris while the island shows and the desk is not in front: it
/// opens on her field with the keys, without making the desk the active app; pressed again while
/// it has them, it folds and gives them back. False leaves her to the floating Eris (ADR 0121).
pub fn summon(shell: &mut Shell) -> bool {
    let Some(state) = shell.desk.island.get().cloned() else {
        return false;
    };
    let Some(pane) = shell.pane(Role::Island).filter(|pane| pane.visible()) else {
        return false;
    };
    if shell
        .pane(Role::Main)
        .is_some_and(|main| main.window.has_focus())
    {
        return false;
    }
    if state.open.load(Relaxed) && pane.window.has_focus() {
        frame::expand(shell, &state, false);
        return true;
    }
    frame::expand(shell, &state, true);
    frame::take_keys(shell);
    let talk = serde_json::Value::Null;
    shell.desk.pages.emit(Role::Island, "island://talk", talk);
    true
}

/// Its window, hidden: transparent around the page, on every Space and over full-screen apps.
fn open_window(shell: &mut Shell, event_loop: &ActiveEventLoop) -> bool {
    let url = crate::palette::view_url(&shell.url, "island");
    let attributes = float::attributes("endue island", CLOSED).with_transparent(true);
    #[cfg(target_os = "macos")]
    let attributes = {
        use winit::platform::macos::WindowAttributesExtMacOS;
        attributes
            .with_has_shadow(false)
            .with_accepts_first_mouse(true)
    };
    let Some(pane) = shell.open_pane(event_loop, Role::Island, attributes, &url) else {
        return false;
    };
    float::join(&pane.window, Spaces::Over);
    if let Err(why) = panel::settle(&pane.window) {
        eprintln!("island: a floating window, not a panel ({why})");
    }
    true
}

/// Whether `desk.island.show` is on; a setting the desk cannot read is off.
pub(crate) fn shown(core: &Core) -> bool {
    let request = json!({ "id": 0, "method": "settings.get", "params": { "key": "show" } });
    call(core, OWNER, request)
        .ok()
        .and_then(|value| value.get("value")?.as_bool())
        .unwrap_or(false)
}

/// desk.island.show changing while the desk runs.
fn watch(desk: &Arc<Desk>) -> std::io::Result<()> {
    let events = desk.core.events().subscribe();
    let pump = desk.pump.clone();
    std::thread::Builder::new()
        .name("desk-island-events".to_owned())
        .spawn(move || {
            for event in events {
                if let BridgeEvent::SettingsChanged(changed) = event
                    && changed.data.owner == OWNER
                    && changed.data.key == "show"
                {
                    pump.run(follow);
                }
            }
        })?;
    Ok(())
}

/// Its window moved: a drag, the shell placing it, or the OS moving it off a display that went.
pub fn moved(shell: &Shell) {
    if let Some(state) = shell.desk.island.get() {
        frame::moved(shell, state);
    }
}

/// A window of `role` gained or lost the keys: the island open and losing them folds.
pub fn focused(shell: &mut Shell, role: Role, focused: bool) {
    if role != Role::Island || focused {
        return;
    }
    if let Some(state) = shell.desk.island.get().cloned()
        && state.open.load(Relaxed)
    {
        frame::expand(shell, &state, false);
    }
}

/// A display came or went: back on the display the person left it on, at their spot there.
fn displays_changed(shell: &mut Shell) {
    let Some(state) = shell.desk.island.get().cloned() else {
        return;
    };
    if shell
        .pane(Role::Island)
        .is_some_and(crate::pane::Pane::visible)
    {
        frame::place(shell, &state);
    }
}
