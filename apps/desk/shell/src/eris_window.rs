//! Where Eris is called (ADR 0121, ADR 0204). A global shortcut, Alt+Enter (⌥↩) unless the person
//! names another (`shortcut`), and the tray's Talk to Eris summon her anywhere: on the island over
//! other apps while it shows (`island::summon`), in the desk's own talk line while the desk is in
//! front, and with the island off, the desk comes forward and opens it there. She had a floating
//! window of her own here until the island took its place; the module keeps its name for the calls
//! the rest of the shell makes (`main_changed`), and holds her shortcut and the notice that another
//! app has it.

pub mod calls;
pub mod shortcut;
#[cfg(test)]
mod tests;

use std::sync::atomic::{AtomicBool, Ordering::Relaxed};
use std::sync::{Arc, Mutex, MutexGuard};

use desk_bridge::{
    BridgeEvent, CmdInvokePermission, CommandChange, Permission, UiNotifyPermission,
};
use desk_core::Core;
use desk_web::sender::Role;
use winit::event_loop::ActiveEventLoop;

use crate::host::Desk;
use crate::hotkeys::Action;
use crate::window::Shell;
use calls::{notice, setting, talk_in_desk};

/// The caller the shortcut runs desk.eris.summon and sends its notice as.
const CALLER: &str = "eris";
/// Whose setting `shortcut` is: `endue.eris.shortcut`.
const OWNER: &str = "endue.eris";
const SUMMON: &str = "desk.eris.summon";
const MAC: bool = cfg!(target_os = "macos");

/// The shortcut in force and whether the desk holds it.
#[derive(Debug, Clone, Default)]
pub struct Shortcut {
    shortcut: String,
    label: String,
    registered: bool,
    problem: Option<String>,
}

pub struct Eris {
    core: Arc<Core>,
    shortcut: Mutex<Shortcut>,
    /// The runtime defined desk.eris.summon: it hears notices now.
    ready: AtomicBool,
    noticed: AtomicBool,
}

/// Hold her shortcut and follow its setting. Call once the main window exists.
pub fn setup(shell: &mut Shell, _event_loop: &ActiveEventLoop) {
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
    let eris = Arc::new(Eris {
        core,
        shortcut: Mutex::default(),
        ready: AtomicBool::new(false),
        noticed: AtomicBool::new(false),
    });
    let _ = shell.desk.eris.set(Arc::clone(&eris));
    register(shell);
    if let Err(why) = watch(&shell.desk, &eris) {
        eprintln!("Eris: the settings are not followed ({why})");
    }
}

/// The global shortcut and the tray's Talk to Eris.
pub fn summon(shell: &mut Shell) {
    if crate::island::summon(shell) {
        return;
    }
    let Some(state) = shell.desk.eris.get().cloned() else {
        return;
    };
    let in_front = shell
        .pane(Role::Main)
        .is_some_and(|main| main.window.has_focus());
    match where_to(in_front) {
        Talk::InDesk => talk_in_desk(&state, true),
        Talk::DeskForward => {
            crate::palette::reveal_main(shell);
            talk_in_desk(&state, false);
        }
    }
}

/// Where the shortcut talks to her when the island does not: in the desk in front, opening or
/// closing her talk line there; otherwise the desk comes forward with it open.
#[derive(Debug, PartialEq, Eq)]
pub enum Talk {
    InDesk,
    DeskForward,
}

pub fn where_to(desk_in_front: bool) -> Talk {
    if desk_in_front {
        Talk::InDesk
    } else {
        Talk::DeskForward
    }
}

/// The main window was shown, hidden, minimized or restored: the island decides again whether the
/// desk is in front.
pub fn main_changed(shell: &Shell) {
    crate::island::nudge(shell);
}

/// The shortcut that summons Eris as it reads (⌥↩), while the desk holds it.
pub(crate) fn shortcut_label(desk: &Desk) -> Option<String> {
    let state = desk.eris.get()?;
    let held = lock(&state.shortcut);
    held.registered.then(|| held.label.clone())
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
    *lock(&state.shortcut) = Shortcut {
        label: shortcut::label(&wanted, MAC),
        registered: problem.is_none(),
        problem,
        shortcut: wanted,
    };
    state.noticed.store(false, Relaxed);
    notice(&state);
}

/// The runtime coming up, and endue.eris.shortcut changing while it runs.
fn watch(desk: &Arc<Desk>, state: &Arc<Eris>) -> std::io::Result<()> {
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
                    }
                    BridgeEvent::SettingsChanged(changed)
                        if changed.data.owner == OWNER && changed.data.key == "shortcut" =>
                    {
                        pump.run(|shell, _| register(shell));
                    }
                    _ => {}
                }
            }
        })?;
    Ok(())
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
