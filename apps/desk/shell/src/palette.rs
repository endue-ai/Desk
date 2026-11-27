//! Search endue over every app (the Tauri shell's `palette.rs`): a window of its own holding the
//! shipped palette (`index.html?view=palette`, which frames `/_desk/palette/` from the binary,
//! `palette_assets.rs`), with the fixed caller `palette` and its grants. Its shortcut
//! (`DESK_PALETTE_SHORTCUT`, else the setting `desk.palette.shortcut`, else ⌘⇧Space; `shortcut.rs`,
//! followed while the desk runs) and the tray's Search endue show and hide it; it hides when
//! it loses the focus. Its commands (`palette_hide`, `palette_present`, `palette_reveal_main`,
//! `palette_prepare_main`) are answered here, on the event loop's thread.

pub mod shortcut;

use std::sync::atomic::{AtomicBool, Ordering::Relaxed};
use std::sync::{Arc, Mutex, MutexGuard};

use desk_bridge::{
    BridgeEvent, CmdInvokePermission, CommandChange, Permission, SearchReadPermission,
    SearchSystemPermission, UiNotifyPermission,
};
use desk_core::Core;
use desk_web::sender::{PALETTE, Role};
use serde_json::{Value, json};
use winit::dpi::PhysicalPosition;
use winit::event_loop::ActiveEventLoop;

use crate::eris_window::calls::call;
use crate::float::{self, Spaces};
use crate::host::Desk;
use crate::hotkeys::{Action, PALETTE_DEFAULT};
use crate::window::Shell;

/// The palette's size, in logical pixels, as the Tauri shell's.
const SIZE: (f64, f64) = (680.0, 480.0);

const MAC: bool = cfg!(target_os = "macos");
/// A command the runtime defines once it is up and its notices show (`settings-ui/window.ts`).
const RUNTIME_UP: &str = "desk.settings.open";

/// The palette's fixed caller may search, run commands and say its key is taken; nothing else.
pub fn grant(core: &Core) {
    core.grant(
        PALETTE,
        Permission::UiNotify(UiNotifyPermission {
            permission: Default::default(),
        }),
    );
    core.grant(
        PALETTE,
        Permission::SearchRead(SearchReadPermission {
            permission: Default::default(),
        }),
    );
    core.grant(
        PALETTE,
        Permission::SearchSystem(SearchSystemPermission {
            permission: Default::default(),
        }),
    );
    core.grant(
        PALETTE,
        Permission::CmdInvoke(CmdInvokePermission {
            permission: Default::default(),
            ids: vec!["*".into()],
        }),
    );
}

/// `url` (the main window's page) asking for one of the shell's other views.
pub fn view_url(url: &str, view: &str) -> String {
    let page = url.split(['?', '#']).next().unwrap_or(url);
    format!("{page}?view={view}")
}

/// Make the palette's window, hidden, and hold its shortcut. Call once the main window exists.
pub fn setup(shell: &mut Shell, event_loop: &ActiveEventLoop) {
    grant(&shell.desk.core);
    let url = view_url(&shell.url, "palette");
    let attributes = float::attributes("Search endue", SIZE);
    if let Some(pane) = shell.open_pane(event_loop, Role::Palette, attributes, &url) {
        float::join(&pane.window, Spaces::All);
    }
    register(shell);
    if let Err(why) = watch(&shell.desk) {
        eprintln!("Search endue: its key's setting is not followed ({why})");
    }
}

/// The setting in force (the runtime's own `palette.shortcut`), if any.
fn setting(core: &Core) -> Option<String> {
    let request = json!({ "id": 0, "method": "settings.get", "params": { "key": shortcut::KEY } });
    let value = call(core, shortcut::OWNER, request).ok()?;
    value.get("value")?.as_str().map(str::to_owned)
}

/// The key the desk holds for the palette now, as written.
static HELD: Mutex<Option<String>> = Mutex::new(None);
/// The runtime is up and shows notices: desk.settings.open is registered.
static READY: AtomicBool = AtomicBool::new(false);
/// A notice that came before the runtime could show it, sent once it can.
static PENDING: Mutex<Option<(String, String)>> = Mutex::new(None);

/// Hold the key in force. When it cannot be had (another app holds it, or it does not read as a
/// key) the one held before stays; at start, with none held yet, ⌘⇧Space is taken instead, so
/// Search endue always has a key. A notice says so, held until the runtime can show it, and Settings
/// › Keyboard learns what is held from `palette.shortcut.held` (`shortcut::held_report`).
fn register(shell: &mut Shell) {
    let env = std::env::var("DESK_PALETTE_SHORTCUT").ok();
    let wanted = shortcut::chosen(env.as_deref(), setting(&shell.desk.core).as_deref());
    let before = lock(&HELD).clone();
    let refused = match shell.hotkeys.register(Action::Palette, &wanted) {
        Ok(()) => {
            *lock(&HELD) = Some(wanted.clone());
            None
        }
        Err(why) => {
            eprintln!("Search endue shortcut unavailable ({wanted}): {why}. Use the tray menu.");
            if before.is_none()
                && wanted != PALETTE_DEFAULT
                && shell
                    .hotkeys
                    .register(Action::Palette, PALETTE_DEFAULT)
                    .is_ok()
            {
                *lock(&HELD) = Some(PALETTE_DEFAULT.to_owned());
            }
            Some(why)
        }
    };
    // A key refused while the desk runs is not kept for the next start: the setting goes back to
    // the key held. One refused at start stays chosen; the other app may let it go by then.
    if let (Some(_), Some(before), None) = (&refused, &before, &env) {
        let request = json!({ "id": 0, "method": "settings.set",
                              "params": { "key": shortcut::KEY, "value": before } });
        if let Err(why) = call(&shell.desk.core, shortcut::OWNER, request) {
            eprintln!("Search endue: the refused key stays saved ({why})");
        }
    }
    let held = lock(&HELD).clone();
    let report = shortcut::held_report(
        held.as_deref(),
        refused.as_deref().map(|why| (&*wanted, why)),
        shortcut::from_env(env.as_deref()),
    );
    let request = json!({ "id": 0, "method": "settings.set",
                          "params": { "key": shortcut::HELD_KEY, "value": report } });
    if let Err(why) = call(&shell.desk.core, shortcut::OWNER, request) {
        eprintln!("Search endue: what its key is was not said to Settings ({why})");
    }
    if let Some(why) = refused {
        let language = crate::language::in_force();
        *lock(&PENDING) = Some(shortcut::taken(language, &wanted, MAC, &why));
        if READY.load(Relaxed) {
            notice(&shell.desk.core);
        }
    }
}

/// The notice waiting, if any, as the palette's caller.
fn notice(core: &Core) {
    let Some((title, body)) = lock(&PENDING).take() else {
        return;
    };
    let request = json!({
        "id": 0,
        "method": "ui.notify",
        "params": { "title": title, "body": body, "level": "warning",
                    "scope": { "permission": "ui:notify" } },
    });
    if let Err(why) = call(core, PALETTE, request) {
        eprintln!("Search endue: the notice was not shown ({why})");
    }
}

/// The runtime coming up (its notices can show from then on), and desk.palette.shortcut changing
/// while the desk runs: Settings › Keyboard writes it with settings.set, which says so.
fn watch(desk: &Desk) -> std::io::Result<()> {
    let events = desk.core.events().subscribe();
    let (pump, core) = (desk.pump.clone(), Arc::clone(&desk.core));
    std::thread::Builder::new()
        .name("desk-palette-events".to_owned())
        .spawn(move || {
            for event in events {
                match event {
                    BridgeEvent::CmdChanged(changed)
                        if changed.data.id == RUNTIME_UP
                            && changed.data.change == CommandChange::Registered =>
                    {
                        READY.store(true, Relaxed);
                        notice(&core);
                    }
                    BridgeEvent::SettingsChanged(changed)
                        if changed.data.owner == shortcut::OWNER
                            && changed.data.key == shortcut::KEY =>
                    {
                        pump.run(|shell, _| register(shell));
                    }
                    _ => {}
                }
            }
        })?;
    Ok(())
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The shortcut: hide the palette when it shows, else show it.
pub fn toggle(shell: &mut Shell) {
    match shell.pane(Role::Palette) {
        Some(pane) if pane.visible() => pane.hide(),
        Some(_) => show(shell),
        None => {}
    }
}

/// Show the palette on the display the person is using, a quarter down, focused, and tell its page.
pub fn show(shell: &mut Shell) {
    let Some(pane) = shell.pane(Role::Palette) else {
        return;
    };
    if let Some(monitor) = crate::displays::cursor_monitor(&pane.window) {
        let size = pane.window.outer_size();
        let (origin, screen) = (monitor.position(), monitor.size());
        let x = origin.x + (screen.width as i32 - size.width as i32) / 2;
        let y = origin.y + ((screen.height as i32 - size.height as i32) / 4).max(0);
        pane.window.set_outer_position(PhysicalPosition::new(x, y));
    }
    pane.show_and_focus();
    shell
        .desk
        .pages
        .emit(Role::Palette, "palette://open", Value::Null);
}

/// Hide the palette and bring the main window forward (a command it ran wants the desk).
pub fn reveal_main(shell: &mut Shell) {
    if let Some(pane) = shell.pane(Role::Palette) {
        pane.hide();
    }
    shell.focus_main();
}

/// A command may open a picker in the main window: show it while the palette keeps the focus.
pub fn prepare_main(shell: &mut Shell) {
    shell.show_main();
}

/// Show the palette again after a failed native action, keeping its query and error.
pub fn present(shell: &mut Shell) {
    if let Some(pane) = shell.pane(Role::Palette) {
        pane.show_and_focus();
    }
}

/// The palette's own commands, from its page or the main window's.
pub fn command(shell: &mut Shell, cmd: &str) {
    match cmd {
        "palette_hide" => {
            if let Some(pane) = shell.pane(Role::Palette) {
                pane.hide();
            }
        }
        "palette_present" => present(shell),
        "palette_reveal_main" => reveal_main(shell),
        "palette_prepare_main" => prepare_main(shell),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::view_url;

    #[test]
    fn the_palette_opens_the_main_page_with_its_view() {
        let start = "desk-app://app/index.html";
        assert_eq!(
            view_url(start, "palette"),
            "desk-app://app/index.html?view=palette"
        );
        assert_eq!(
            view_url("desk-app://app/index.html?safe=1#x", "palette"),
            "desk-app://app/index.html?view=palette"
        );
    }
}
