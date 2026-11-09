//! Eris over the OS (ADR 0121), on the CEF shell. While the desk is not the active app she floats in
//! a small window of her own: always on top, on every Space, out of the Dock and the task switcher,
//! transparent around her figure. A global shortcut (Alt+Enter) summons her anywhere: inside the
//! desk while it is in front, in the floating window otherwise. What to do lives in `machine`, where
//! she sits (per display) in `place`, the key in `shortcut` (all three ported as they were); this
//! file makes the window, feeds the machine and carries out what it returns on the event loop's
//! thread. The window's page calls the core as the desk, for her conversation only
//! (`desk_web::sender`).

pub mod calls;
pub mod commands;
mod frame;
pub mod machine;
pub mod place;
pub mod shortcut;
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
use desk_web::sender::Role;
use winit::event_loop::ActiveEventLoop;

use crate::float::{self, Spaces};
use crate::host::Desk;
use crate::hotkeys::Action;
use crate::window::Shell;
use calls::{mode, notice, setting, talk_in_desk};
use machine::{Effect, Event, Machine, Win};
use place::{Positions, Rect};

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
const WINDOWS: [(Role, Win); 3] = [
    (Role::Main, Win::Main),
    (Role::Palette, Win::Palette),
    (Role::Eris, Win::Eris),
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

/// Make her window, hidden, hold her shortcut and follow the settings. Call once the main window
/// and the palette exist.
pub fn setup(shell: &mut Shell, event_loop: &ActiveEventLoop) {
    let core = Arc::clone(&shell.desk.core);
    core.grant(
        CALLER,
        Permission::CmdInvoke(CmdInvokePermission {
            permission: Default::default(),
            ids: vec![SUMMON.to_owned()],
        }),
    );
    core.grant(
        CALLER,
        Permission::UiNotify(UiNotifyPermission {
            permission: Default::default(),
        }),
    );
    let file = crate::paths::data_dir().join(FILE);
    let positions = std::fs::read_to_string(&file)
        .map(|text| Positions::parse(&text))
        .unwrap_or_default();
    let url = crate::palette::view_url(&shell.url, "eris");
    let attributes = float::attributes("Eris", FIGURE).with_transparent(true);
    #[cfg(target_os = "macos")]
    let attributes = {
        use winit::platform::macos::WindowAttributesExtMacOS;
        attributes
            .with_has_shadow(false)
            .with_accepts_first_mouse(true)
    };
    if let Some(pane) = shell.open_pane(event_loop, Role::Eris, attributes, &url) {
        float::join(&pane.window, Spaces::Over);
    }
    let pump = shell.desk.pump.clone();
    let eris = Arc::new_cyclic(|this: &std::sync::Weak<ErisWindow>| {
        let this = this.clone();
        ErisWindow {
            machine: Mutex::new(Machine::new(mode(&core))),
            core: Arc::clone(&core),
            positions: Mutex::new(positions),
            shortcut: Mutex::default(),
            folded: Mutex::default(),
            open: AtomicBool::new(false),
            dragged: AtomicBool::new(false),
            ready: AtomicBool::new(false),
            noticed: AtomicBool::new(false),
            settle: debounce("desk-eris-settle", SETTLE, move || {
                pump.run(|shell, _| settle(shell));
            }),
            keep: debounce("desk-eris-keep", REST, move || {
                if let Some(state) = this.upgrade() {
                    frame::keep(&state, &file);
                }
            }),
        }
    });
    let _ = shell.desk.eris.set(Arc::clone(&eris));
    register(shell);
    if let Err(why) = watch(&shell.desk, &eris) {
        eprintln!("Eris: the settings are not followed ({why})");
    }
}

/// The global shortcut and the tray's Talk to Eris.
pub fn summon(shell: &mut Shell) {
    if let Some(state) = shell.desk.eris.get().cloned() {
        let effects = state.feed(Event::Shortcut);
        apply(shell, &state, effects);
    }
}

/// A window of `role` gained or lost the focus.
pub fn focused(shell: &Shell, role: Role, focused: bool) {
    let (Some(state), Some(win)) = (shell.desk.eris.get(), win_of(role)) else {
        return;
    };
    state.feed(Event::Focus(win, focused));
    let _ = state.settle.send(());
}

/// The main window was shown, hidden, minimized or restored: settle reads whether it is on screen.
pub fn main_changed(shell: &Shell) {
    if let Some(state) = shell.desk.eris.get() {
        let _ = state.settle.send(());
    }
}

/// Her window moved (a drag, or the shell placing it).
pub fn moved(shell: &Shell) {
    if let Some(state) = shell.desk.eris.get() {
        frame::moved(shell, state);
    }
}

/// Her window's close request: she goes away, as with Esc.
pub fn dismiss(shell: &mut Shell) {
    if let Some(state) = shell.desk.eris.get().cloned() {
        let effects = state.feed(Event::Dismiss);
        apply(shell, &state, effects);
    }
}

fn win_of(role: Role) -> Option<Win> {
    WINDOWS
        .iter()
        .find(|(r, _)| *r == role)
        .map(|(_, win)| *win)
}

fn settle(shell: &mut Shell) {
    let Some(state) = shell.desk.eris.get().cloned() else {
        return;
    };
    // The windows as they are now, whichever focus events arrived and in what order.
    for (role, win) in WINDOWS {
        if let Some(pane) = shell.pane(role) {
            state.feed(Event::Focus(win, pane.window.has_focus()));
        }
    }
    let on_screen = shell
        .pane(Role::Main)
        .is_none_or(|main| main.visible() && !main.window.is_minimized().unwrap_or(false));
    state.feed(Event::MainOnScreen(on_screen));
    let effects = state.feed(Event::Mode(mode(&state.core)));
    apply(shell, &state, effects);
}

fn apply(shell: &mut Shell, state: &ErisWindow, effects: Vec<Effect>) {
    for effect in effects {
        match effect {
            Effect::Show { summon } => frame::show(shell, state, summon),
            Effect::Hide => frame::hide(shell, state),
            Effect::RevealMain => crate::palette::reveal_main(shell),
            Effect::TalkInDesk { toggle } => talk_in_desk(state, toggle),
        }
    }
}

/// Hold the shortcut in force, letting go of the one before; say so when it cannot be had.
fn register(shell: &mut Shell) {
    let Some(state) = shell.desk.eris.get().cloned() else {
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
        shell.hotkeys.unregister(Action::Eris);
    }
    let problem = shell.hotkeys.register(Action::Eris, &wanted).err();
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
    let payload = serde_json::to_value(now).unwrap_or_default();
    shell
        .desk
        .pages
        .emit(Role::Eris, "eris://shortcut", payload);
}

/// The runtime coming up, and endue.eris.float and endue.eris.shortcut changing while it runs.
fn watch(desk: &Arc<Desk>, state: &Arc<ErisWindow>) -> std::io::Result<()> {
    let events = state.core.events().subscribe();
    let (pump, state) = (desk.pump.clone(), Arc::clone(state));
    std::thread::Builder::new()
        .name("desk-eris-events".to_owned())
        .spawn(move || {
            for event in events {
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
                            "shortcut" => pump.run(|shell, _| register(shell)),
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
