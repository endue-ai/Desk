//! Eris over the OS (ADR 0121). While the desk is not the active app she floats in a small window of
//! her own: always on top, on every Space, out of the Dock and the task switcher, transparent around
//! her figure. A global shortcut (Alt+Enter) summons her anywhere: inside the desk while it is in
//! front, in the floating window otherwise. What to do lives in `machine`, where she sits (per
//! display) in `place`, the key in `shortcut`; this file makes the window, feeds the machine and
//! carries out what it returns. The window calls the core as the desk (`commands/bridge.rs`).

mod calls;
mod commands;
mod frame;
mod machine;
#[cfg(target_os = "macos")]
mod macos;
mod place;
mod shortcut;
#[cfg(test)]
mod tests;

use std::sync::atomic::{AtomicBool, Ordering::Relaxed};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use desk_bridge::{
    BridgeEvent, CmdInvokePermission, CommandChange, Permission, UiNotifyPermission,
};
use desk_core::Core;
use tauri::{
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub use calls::check;
use calls::{mode, notice, setting, talk_in_desk};
use frame::{hide, moved, show};
use machine::{Effect, Event, Machine, Win};
use place::{Positions, Rect};

pub const LABEL: &str = "eris";
/// The caller the shortcut runs desk.eris.summon and sends its notice as; the window is the desk.
const CALLER: &str = "eris";
/// Whose settings `float` and `shortcut` are: `endue.eris.float`, `endue.eris.shortcut`.
const OWNER: &str = "endue.eris";
const SUMMON: &str = "desk.eris.summon";
const FILE: &str = "eris-window.json";
/// Her figure alone and with her composer open, in logical pixels.
const FIGURE: (f64, f64) = (168.0, 200.0);
const OPEN: (f64, f64) = (360.0, 520.0);
const MARGIN: f64 = 24.0;
/// Focus moves in bursts (one window blurs, then the next focuses): decide once it has settled.
const SETTLE: Duration = Duration::from_millis(150);
/// A drag moves the window many times a second: keep where it ended once it has rested.
const REST: Duration = Duration::from_millis(500);
const MAC: bool = cfg!(target_os = "macos");
/// The windows whose focus decides where she is.
const WINDOWS: [(&str, Win); 3] = [
    ("main", Win::Main),
    (crate::palette::LABEL, Win::Palette),
    (LABEL, Win::Eris),
];

/// The shortcut in force and whether the desk holds it, as the floating window shows it.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct Shortcut {
    shortcut: String,
    label: String,
    registered: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    problem: Option<String>,
}

pub struct ErisWindow {
    core: Arc<Core>,
    machine: Mutex<Machine>,
    positions: Mutex<Positions>,
    shortcut: Mutex<Shortcut>,
    /// Where the figure was before the window grew for the composer.
    folded: Mutex<Option<Rect>>,
    open: AtomicBool,
    /// The person dragged her since the composer opened.
    dragged: AtomicBool,
    /// The runtime defined desk.eris.summon: it hears notices now.
    ready: AtomicBool,
    noticed: AtomicBool,
    settle: Sender<()>,
    keep: Sender<()>,
}

impl ErisWindow {
    fn feed(&self, event: Event) -> Vec<Effect> {
        lock(&self.machine).on(event)
    }
}

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let core = Arc::clone(&app.state::<Arc<Core>>());
    let ids = vec![SUMMON.to_owned()];
    core.grant(
        CALLER,
        Permission::CmdInvoke(CmdInvokePermission {
            permission: Default::default(),
            ids,
        }),
    );
    core.grant(
        CALLER,
        Permission::UiNotify(UiNotifyPermission {
            permission: Default::default(),
        }),
    );
    let file = app.path().app_data_dir()?.join(FILE);
    let positions = std::fs::read_to_string(&file)
        .map(|text| Positions::parse(&text))
        .unwrap_or_default();
    build(app)?;
    let handle = app.handle().clone();
    handle.plugin(commands::plugin())?;
    let (settled, kept) = (handle.clone(), handle.clone());
    app.manage(ErisWindow {
        machine: Mutex::new(Machine::new(mode(&core))),
        core: Arc::clone(&core),
        positions: Mutex::new(positions),
        shortcut: Mutex::default(),
        folded: Mutex::default(),
        open: AtomicBool::new(false),
        dragged: AtomicBool::new(false),
        ready: AtomicBool::new(false),
        noticed: AtomicBool::new(false),
        settle: debounce("desk-eris-settle", SETTLE, move || settle(&settled)),
        keep: debounce("desk-eris-keep", REST, move || frame::keep(&kept, &file)),
    });
    register(&handle);
    for (label, win) in WINDOWS {
        if let Some(window) = app.get_webview_window(label) {
            let app = handle.clone();
            window.on_window_event(move |event| on_window(&app, win, event));
        }
    }
    watch(&handle, &core)?;
    Ok(())
}

fn build(app: &tauri::App) -> tauri::Result<WebviewWindow> {
    let url = WebviewUrl::App("index.html?view=eris".into());
    let window = WebviewWindowBuilder::new(app, LABEL, url)
        .title("Eris")
        .inner_size(FIGURE.0, FIGURE.1)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .shadow(false)
        // macos-private-api on macOS; where a platform cannot, she sits in a small plain window.
        .transparent(true)
        .accept_first_mouse(true)
        .visible(false)
        .focused(false)
        .build()?;
    // The setup closure runs on the main thread, as AppKit wants.
    #[cfg(target_os = "macos")]
    if let Ok(ns_window) = window.ns_window() {
        macos::float(ns_window);
    }
    Ok(window)
}

/// The global shortcut and the tray's Talk to Eris.
pub fn summon(app: &AppHandle) {
    if let Some(state) = app.try_state::<ErisWindow>() {
        let effects = state.feed(Event::Shortcut);
        apply(app, effects);
    }
}

fn on_window(app: &AppHandle, win: Win, event: &WindowEvent) {
    let Some(state) = app.try_state::<ErisWindow>() else {
        return;
    };
    match (win, event) {
        (_, WindowEvent::Focused(focused)) => {
            state.feed(Event::Focus(win, *focused));
            let _ = state.settle.send(());
        }
        // Minimized and restored: settle reads whether it is on screen.
        (Win::Main, WindowEvent::Resized(_)) => {
            let _ = state.settle.send(());
        }
        (Win::Eris, WindowEvent::Moved(_)) => moved(app, &state),
        (Win::Eris, WindowEvent::CloseRequested { api, .. }) => {
            api.prevent_close();
            let effects = state.feed(Event::Dismiss);
            apply(app, effects);
        }
        _ => {}
    }
}

fn settle(app: &AppHandle) {
    let Some(state) = app.try_state::<ErisWindow>() else {
        return;
    };
    // The windows as they are now, whichever focus events arrived and in what order.
    for (label, win) in WINDOWS {
        if let Some(window) = app.get_webview_window(label)
            && let Ok(focused) = window.is_focused()
        {
            state.feed(Event::Focus(win, focused));
        }
    }
    let on_screen = app.get_webview_window("main").is_none_or(|main| {
        main.is_visible().unwrap_or(true) && !main.is_minimized().unwrap_or(false)
    });
    state.feed(Event::MainOnScreen(on_screen));
    let effects = state.feed(Event::Mode(mode(&state.core)));
    apply(app, effects);
}

fn apply(app: &AppHandle, effects: Vec<Effect>) {
    for effect in effects {
        let done = match effect {
            Effect::Show { summon } => show(app, summon),
            Effect::Hide => hide(app),
            Effect::RevealMain => crate::palette::reveal_main(app),
            Effect::TalkInDesk { toggle } => {
                talk_in_desk(app, toggle);
                Ok(())
            }
        };
        if let Err(why) = done {
            eprintln!("Eris: {why}");
        }
    }
}

/// Register the shortcut in force, letting go of the one before; say so when it cannot be had.
fn register(app: &AppHandle) {
    let Some(state) = app.try_state::<ErisWindow>() else {
        return;
    };
    let env = std::env::var("DESK_ERIS_SHORTCUT").ok();
    let set = setting(&state.core, "shortcut");
    let wanted = shortcut::chosen(env.as_deref(), set.as_deref());
    let before = lock(&state.shortcut).clone();
    if before.registered {
        if before.shortcut == wanted {
            return;
        }
        let _ = app.global_shortcut().unregister(before.shortcut.as_str());
    }
    let result = app
        .global_shortcut()
        .on_shortcut(wanted.as_str(), |app, _, event| {
            if event.state == ShortcutState::Pressed {
                summon(app);
            }
        });
    let problem = result.err().map(|why| why.to_string());
    if let Some(why) = &problem {
        eprintln!(
            "Eris: the shortcut {wanted} is unavailable ({why}); use Talk to Eris in the tray"
        );
    }
    let now = Shortcut {
        label: shortcut::label(&wanted, MAC),
        registered: problem.is_none(),
        problem,
        shortcut: wanted,
    };
    *lock(&state.shortcut) = now.clone();
    state.noticed.store(false, Relaxed);
    notice(&state);
    let _ = app.emit_to(LABEL, "eris://shortcut", now);
}

/// The runtime coming up, and endue.eris.float and endue.eris.shortcut changing while it runs.
fn watch(app: &AppHandle, core: &Core) -> std::io::Result<()> {
    let events = core.events().subscribe();
    let app = app.clone();
    std::thread::Builder::new()
        .name("desk-eris-events".to_owned())
        .spawn(move || {
            for event in events {
                let Some(state) = app.try_state::<ErisWindow>() else {
                    continue;
                };
                match event {
                    BridgeEvent::CmdChanged(changed)
                        if changed.data.id == SUMMON
                            && changed.data.change == CommandChange::Registered =>
                    {
                        state.ready.store(true, Relaxed);
                        notice(&state);
                        let _ = state.settle.send(());
                    }
                    BridgeEvent::SettingsChanged(changed) if changed.data.owner == OWNER => {
                        match changed.data.key.as_str() {
                            "shortcut" => register(&app),
                            "float" => {
                                let _ = state.settle.send(());
                            }
                            _ => {}
                        }
                    }
                    _ => {}
                }
            }
        })?;
    Ok(())
}

/// Run `run` once `rest` has passed without another nudge, on a thread of its own.
fn debounce(name: &str, rest: Duration, run: impl Fn() + Send + 'static) -> Sender<()> {
    let (nudge, nudged) = mpsc::channel::<()>();
    let spawned = std::thread::Builder::new()
        .name(name.to_owned())
        .spawn(move || {
            while nudged.recv().is_ok() {
                while nudged.recv_timeout(rest).is_ok() {}
                run();
            }
        });
    if let Err(why) = spawned {
        eprintln!("Eris: {name} did not start ({why})");
    }
    nudge
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
