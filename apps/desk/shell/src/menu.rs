//! The menus (`muda`, through `tray-icon`): the tray's (ADR 0053, `tray.rs`) and, on macOS, the
//! app's menu bar. The menu bar carries the standard Edit items, which the windowed CEF views (the
//! palette, Eris, the banner) answer as menu actions, and Quit, which goes the desk's own way out
//! (closing every browser before CEF shuts down) instead of `terminate:`. The desk's own window
//! holds only off-screen pages, and its view answers none of Edit's actions, so there the items stay
//! off and their key equivalents pass on to the window: the focused page hears ⌘C, ⌘V and the rest
//! as keys that go down with their edit commands (#156, `web_host/edit_keys.rs`), as a windowed view
//! would have run them, and a page that binds one of them keeps it. A choice reaches the event loop
//! as a job (`Shell::menu`). Every item is in the desk's language (`model.rs`, ADR 0276) and is
//! re-worded in place when it changes, so AppKit keeps the windows it lists under Window.

mod model;

pub use model::{APP, Entry, Section, Standard, bar, texts};

use tray_icon::menu::{Menu, MenuEvent, MenuId, MenuItem};

use crate::pump::Pump;
use crate::words::Language;

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
    /// Window > Move to Desk: the window out of the canvas in front docks back (#235).
    Dock,
}

const ITEMS: [(&str, Choice); 6] = [
    ("search", Choice::Search),
    ("eris", Choice::Eris),
    ("desk", Choice::Desk),
    ("update", Choice::Update),
    ("quit", Choice::Quit),
    ("dock", Choice::Dock),
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

/// The app's menu bar and the items it words, kept for the app's life: re-worded in place.
pub struct MenuBar {
    /// The bar AppKit shows (`init_for_nsapp`); held so its items live as long.
    _menu: Menu,
    /// Every place with words, in the order of [`texts`].
    worded: Vec<Worded>,
}

/// A place in the menu bar that has words. Only macOS has a menu bar to make them for.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
enum Worded {
    Menu(tray_icon::menu::Submenu),
    Item(MenuItem),
    Standard(tray_icon::menu::PredefinedMenuItem),
}

impl MenuBar {
    /// Every item in `language`'s words.
    pub fn reword(&self, language: Language) {
        for (worded, text) in self.worded.iter().zip(texts(language)) {
            match worded {
                Worded::Menu(menu) => menu.set_text(&text),
                Worded::Item(item) => item.set_text(&text),
                Worded::Standard(item) => item.set_text(&text),
            }
        }
    }
}

/// The app's menu bar on macOS, in `language`: the app menu (About, Hide, Quit) and the Edit and
/// Window menus. Elsewhere there is none: Edit's keys work in CEF without one.
pub fn app_menu(language: Language) -> Option<MenuBar> {
    #[cfg(target_os = "macos")]
    {
        let made = mac_menu(language).map_err(|why| eprintln!("endue Desk: no menu bar ({why})"));
        let (bar, window) = made.ok()?;
        bar._menu.init_for_nsapp();
        // AppKit lists the desk's window and its windows out of the canvas under Window (#235);
        // the floating ones keep out of it (`float.rs`).
        window.set_as_windows_menu_for_nsapp();
        eprintln!(
            "endue Desk: the menu bar is set (Edit: Undo, Redo, Cut, Copy, Paste, Select All)"
        );
        Some(bar)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = language;
        None
    }
}

/// The titles of the windows the app's Window menu lists, as AppKit keeps them: the items it adds
/// for its windows bring one in front (`makeKeyAndOrderFront:`). For the app e2e's check.
pub fn listed_windows() -> Vec<String> {
    #[cfg(target_os = "macos")]
    return mac_listed_windows();
    #[cfg(not(target_os = "macos"))]
    Vec::new()
}

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
fn mac_listed_windows() -> Vec<String> {
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Sel};
    use objc2::{msg_send, sel};
    use objc2_app_kit::NSApplication;
    use objc2_foundation::{MainThreadMarker, NSString};

    let Some(mtm) = MainThreadMarker::new() else {
        return Vec::new();
    };
    let app = NSApplication::sharedApplication(mtm);
    // SAFETY: `windowsMenu` (NSApplication), `numberOfItems` and `itemAtIndex:` (NSMenu), `action`
    // and `title` (NSMenuItem) return what they are declared to, read on the main thread.
    unsafe {
        let menu: Option<Retained<AnyObject>> = msg_send![&app, windowsMenu];
        let Some(menu) = menu else {
            return Vec::new();
        };
        let count: isize = msg_send![&menu, numberOfItems];
        (0..count)
            .filter_map(|i| {
                let item: Option<Retained<AnyObject>> = msg_send![&menu, itemAtIndex: i];
                let item = item?;
                let action: Option<Sel> = msg_send![&item, action];
                if action != Some(sel!(makeKeyAndOrderFront:)) {
                    return None;
                }
                let title: Retained<NSString> = msg_send![&item, title];
                Some(title.to_string())
            })
            .collect()
    }
}

/// The menu bar `bar` describes in `language`, and its Window menu.
#[cfg(target_os = "macos")]
fn mac_menu(language: Language) -> tray_icon::menu::Result<(MenuBar, tray_icon::menu::Submenu)> {
    use tray_icon::menu::{IsMenuItem, Submenu, accelerator::Accelerator};
    let mut worded = Vec::new();
    let mut menus = Vec::new();
    for section in bar(language) {
        let menu = Submenu::new(&section.title, true);
        worded.push(Worded::Menu(menu.clone()));
        for entry in section.entries {
            let row: Box<dyn IsMenuItem> = match entry {
                Entry::Item { choice, text, keys } => {
                    let keys = keys.and_then(|k| k.parse::<Accelerator>().ok());
                    let item = MenuItem::with_id(choice.id(), text, true, keys);
                    worded.push(Worded::Item(item.clone()));
                    Box::new(item)
                }
                Entry::Standard { kind, text } => {
                    let item = standard(kind, &text);
                    worded.push(Worded::Standard(item.clone()));
                    Box::new(item)
                }
                Entry::Separator => Box::new(tray_icon::menu::PredefinedMenuItem::separator()),
            };
            menu.append(row.as_ref())?;
        }
        menus.push(menu);
    }
    let window = menus.last().cloned().expect("the bar ends with Window");
    let refs: Vec<&dyn IsMenuItem> = menus.iter().map(|m| m as &dyn IsMenuItem).collect();
    let menu = Menu::with_items(&refs)?;
    Ok((
        MenuBar {
            _menu: menu,
            worded,
        },
        window,
    ))
}

/// The item AppKit runs for `kind`, named `text`.
#[cfg(target_os = "macos")]
fn standard(kind: Standard, text: &str) -> tray_icon::menu::PredefinedMenuItem {
    use tray_icon::menu::PredefinedMenuItem as P;
    let text = Some(text);
    match kind {
        Standard::About => P::about(text, None),
        Standard::Services => P::services(text),
        Standard::Hide => P::hide(text),
        Standard::HideOthers => P::hide_others(text),
        Standard::ShowAll => P::show_all(text),
        Standard::Undo => P::undo(text),
        Standard::Redo => P::redo(text),
        Standard::Cut => P::cut(text),
        Standard::Copy => P::copy(text),
        Standard::Paste => P::paste(text),
        Standard::SelectAll => P::select_all(text),
        Standard::Minimize => P::minimize(text),
        Standard::CloseWindow => P::close_window(text),
    }
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
