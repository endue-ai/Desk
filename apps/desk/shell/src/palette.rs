//! Search Desk over every app (the Tauri shell's `palette.rs`): a window of its own holding the
//! shipped palette (`index.html?view=palette`, which frames `/_desk/palette/` from the binary,
//! `palette_assets.rs`), with the fixed caller `palette` and its three grants. Its shortcut
//! (`DESK_PALETTE_SHORTCUT`, else ⌘⇧Space) and the tray's Search Desk show and hide it; it hides when
//! it loses the focus. Its commands (`palette_hide`, `palette_present`, `palette_reveal_main`,
//! `palette_prepare_main`) are answered here, on the event loop's thread.

use desk_bridge::{CmdInvokePermission, Permission, SearchReadPermission, SearchSystemPermission};
use desk_core::Core;
use desk_web::sender::{PALETTE, Role};
use serde_json::Value;
use winit::dpi::PhysicalPosition;
use winit::event_loop::ActiveEventLoop;

use crate::float::{self, Spaces};
use crate::hotkeys::{Action, PALETTE_DEFAULT};
use crate::window::Shell;

/// The palette's size, in logical pixels, as the Tauri shell's.
const SIZE: (f64, f64) = (680.0, 480.0);

/// The palette's fixed caller may search and run commands; nothing else.
pub fn grant(core: &Core) {
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
    let attributes = float::attributes("Search Desk", SIZE);
    if let Some(pane) = shell.open_pane(event_loop, Role::Palette, attributes, &url) {
        float::join(&pane.window, Spaces::All);
    }
    // Preserve macOS Spotlight and input-source shortcuts. This can be changed before app startup.
    let shortcut =
        std::env::var("DESK_PALETTE_SHORTCUT").unwrap_or_else(|_| PALETTE_DEFAULT.to_owned());
    if let Err(why) = shell.hotkeys.register(Action::Palette, &shortcut) {
        eprintln!("Search Desk shortcut unavailable ({shortcut}): {why}. Use the tray menu.");
    }
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
    if let Some(main) = shell.pane(Role::Main) {
        main.window.set_minimized(false);
        main.show_and_focus();
    }
}

/// A command may open a picker in the main window: show it while the palette keeps the focus.
pub fn prepare_main(shell: &mut Shell) {
    if let Some(main) = shell.pane(Role::Main) {
        main.window.set_minimized(false);
        main.window.set_visible(true);
    }
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
            view_url("desk-app://app/index.html?safe=1#x", "island"),
            "desk-app://app/index.html?view=island"
        );
    }
}
