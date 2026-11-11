//! The menus (`muda`, through `tray-icon`): the tray's (ADR 0053, `tray.rs`) and, on macOS, the
//! app's menu bar. The menu bar carries the standard Edit items, which the windowed CEF views (the
//! palette, Eris, the banner) answer as menu actions, and Quit, which goes the desk's own way out
//! (closing every browser before CEF shuts down) instead of `terminate:`. The desk's own window
//! holds only off-screen pages, and its view answers none of Edit's actions, so there the items stay
//! off and their key equivalents pass on to the window: the focused page hears ⌘C, ⌘V and the rest
//! as keys that go down with their edit commands (#156, `web_host/edit_keys.rs`), as a windowed view
//! would have run them, and a page that binds one of them keeps it. A choice reaches the event loop
//! as a job (`Shell::menu`).

use tray_icon::menu::{Menu, MenuEvent, MenuId, MenuItem};

use crate::pump::Pump;

/// What a menu item does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Choice {
    /// Search Desk (the palette).
    Search,
    /// Talk to Eris: as her shortcut does.
    Eris,
    /// Open Desk: the main window in front.
    Desk,
    /// Restart to update (ADR 0054): into the staged build.
    Update,
    /// Quit Desk.
    Quit,
}

const ITEMS: [(&str, Choice); 5] = [
    ("search", Choice::Search),
    ("eris", Choice::Eris),
    ("desk", Choice::Desk),
    ("update", Choice::Update),
    ("quit", Choice::Quit),
];

impl Choice {
    /// The item's id in every menu.
    pub fn id(self) -> &'static str {
        ITEMS
            .iter()
            .find(|(_, choice)| *choice == self)
            .map_or("", |(id, _)| id)
    }

    /// The choice an item's `id` is; the predefined items (Copy, Hide, …) are none.
    pub fn of(id: &MenuId) -> Option<Self> {
        ITEMS
            .iter()
            .find(|(name, _)| id == *name)
            .map(|(_, choice)| *choice)
    }
}

/// An item of `choice` with `text`.
pub fn item(choice: Choice, text: &str) -> MenuItem {
    MenuItem::with_id(choice.id(), text, true, None)
}

/// Send menu choices to the event loop. Call once.
pub fn listen(pump: &Pump) {
    let pump = pump.clone();
    MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
        if let Some(choice) = Choice::of(event.id()) {
            pump.run(move |shell, event_loop| shell.menu(event_loop, choice));
        }
    }));
}

/// The app's menu bar on macOS: the app menu (About, Hide, Quit) and the Edit and Window menus.
/// Elsewhere there is none: Edit's keys work in CEF without one. Keep the menu for the app's life.
pub fn app_menu() -> Option<Menu> {
    #[cfg(target_os = "macos")]
    {
        let menu = mac_menu().map_err(|why| eprintln!("endue Desk: no menu bar ({why})"));
        let menu = menu.ok()?;
        menu.init_for_nsapp();
        eprintln!(
            "endue Desk: the menu bar is set (Edit: Undo, Redo, Cut, Copy, Paste, Select All)"
        );
        Some(menu)
    }
    #[cfg(not(target_os = "macos"))]
    None
}

#[cfg(target_os = "macos")]
fn mac_menu() -> tray_icon::menu::Result<Menu> {
    use tray_icon::menu::{PredefinedMenuItem as P, Submenu, accelerator::Accelerator};
    let quit = MenuItem::with_id(
        Choice::Quit.id(),
        "Quit endue Desk",
        true,
        "CmdOrCtrl+Q".parse::<Accelerator>().ok(),
    );
    let app = Submenu::with_items(
        "endue Desk",
        true,
        &[
            &P::about(Some("About endue Desk"), None),
            &P::separator(),
            &P::services(None),
            &P::separator(),
            &P::hide(None),
            &P::hide_others(None),
            &P::show_all(None),
            &P::separator(),
            &quit,
        ],
    )?;
    let edit = Submenu::with_items(
        "Edit",
        true,
        &[
            &P::undo(None),
            &P::redo(None),
            &P::separator(),
            &P::cut(None),
            &P::copy(None),
            &P::paste(None),
            &P::select_all(None),
        ],
    )?;
    let window = Submenu::with_items(
        "Window",
        true,
        &[&P::minimize(None), &P::close_window(None)],
    )?;
    Menu::with_items(&[&app, &edit, &window])
}

#[cfg(test)]
mod tests {
    use super::{Choice, ITEMS};
    use tray_icon::menu::MenuId;

    #[test]
    fn every_choice_has_one_id_and_reads_back_from_it() {
        for (id, choice) in ITEMS {
            assert_eq!(choice.id(), id);
            assert_eq!(Choice::of(&MenuId::new(id)), Some(choice));
        }
        // The predefined items have muda's own ids: they are AppKit's, not the desk's.
        assert_eq!(Choice::of(&MenuId::new("1001")), None);
        assert_eq!(Choice::of(&MenuId::new("Quit")), None);
    }
}
