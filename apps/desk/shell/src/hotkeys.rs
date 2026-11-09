//! Global shortcuts (`global-hotkey`, as `tauri-plugin-global-shortcut` was): Search Desk's
//! (`DESK_PALETTE_SHORTCUT`, else ⌘⇧Space), Eris's (ADR 0121, `shortcut.rs`) and the computer-use
//! stop key while an agent acts (ADR 0123). Shortcuts are written as Tauri's plugin read them
//! (`CommandOrControl+Shift+Space`, `Alt+Enter`, `Escape`): the same parser. Presses reach the event
//! loop as jobs; which action a press is lives in [`Table`], tested without the OS.

use std::collections::HashMap;

use global_hotkey::hotkey::HotKey;
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};

use crate::pump::Pump;

/// Search Desk's shortcut unless `DESK_PALETTE_SHORTCUT` names another: it leaves macOS Spotlight's
/// and the input-source shortcuts alone.
pub const PALETTE_DEFAULT: &str = "CommandOrControl+Shift+Space";

/// What a global shortcut does.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Action {
    /// Show or hide Search Desk.
    Palette,
    /// Summon Eris (ADR 0121).
    Eris,
    /// Stop the agent operating the computer (ADR 0123).
    StopComputer,
}

/// A shortcut as Tauri's global-shortcut plugin read it.
pub fn parse(text: &str) -> Result<HotKey, String> {
    text.trim()
        .parse::<HotKey>()
        .map_err(|why| format!("{text:?} is not a shortcut ({why})"))
}

/// Which shortcut each action holds, and which action a pressed shortcut is.
#[derive(Default)]
pub struct Table {
    held: HashMap<Action, HotKey>,
}

impl Table {
    /// The shortcut `action` holds now.
    pub fn held(&self, action: Action) -> Option<HotKey> {
        self.held.get(&action).copied()
    }

    /// The action whose shortcut has `id`.
    pub fn action(&self, id: u32) -> Option<Action> {
        self.held
            .iter()
            .find(|(_, key)| key.id() == id)
            .map(|(action, _)| *action)
    }

    /// Whether another action holds `key` already.
    pub fn taken(&self, action: Action, key: HotKey) -> Option<Action> {
        self.held
            .iter()
            .find(|(other, held)| **other != action && held.id() == key.id())
            .map(|(other, _)| *other)
    }

    pub fn hold(&mut self, action: Action, key: HotKey) -> Option<HotKey> {
        self.held.insert(action, key)
    }

    pub fn release(&mut self, action: Action) -> Option<HotKey> {
        self.held.remove(&action)
    }
}

/// The OS's global shortcuts for this desk. Make it on the event loop's thread.
pub struct Hotkeys {
    manager: Option<GlobalHotKeyManager>,
    table: Table,
}

impl Hotkeys {
    /// The manager, with presses sent to the event loop as `Shell::hotkey` jobs.
    pub fn new(pump: &Pump) -> Self {
        let manager = match GlobalHotKeyManager::new() {
            Ok(manager) => Some(manager),
            Err(why) => {
                eprintln!("endue Desk: no global shortcuts ({why}); use the tray");
                None
            }
        };
        let pump = pump.clone();
        GlobalHotKeyEvent::set_event_handler(Some(move |event: GlobalHotKeyEvent| {
            let (id, pressed) = (event.id(), event.state() == HotKeyState::Pressed);
            pump.run(move |shell, event_loop| shell.hotkey(event_loop, id, pressed));
        }));
        Self {
            manager,
            table: Table::default(),
        }
    }

    /// Hold `text` for `action`, letting go of the shortcut it held before.
    pub fn register(&mut self, action: Action, text: &str) -> Result<(), String> {
        let key = parse(text)?;
        if self
            .table
            .held(action)
            .is_some_and(|held| held.id() == key.id())
        {
            return Ok(());
        }
        if let Some(other) = self.table.taken(action, key) {
            return Err(format!("the desk holds {text} for {other:?} already"));
        }
        let manager = self.manager.as_ref().ok_or("no global shortcuts here")?;
        manager.register(key).map_err(|why| why.to_string())?;
        if let Some(before) = self.table.hold(action, key) {
            let _ = manager.unregister(before);
        }
        eprintln!("endue Desk: the shortcut {text} is held for {action:?}");
        Ok(())
    }

    /// Let go of `action`'s shortcut.
    pub fn unregister(&mut self, action: Action) {
        if let (Some(key), Some(manager)) = (self.table.release(action), self.manager.as_ref()) {
            let _ = manager.unregister(key);
        }
    }

    /// The action a press of shortcut `id` is.
    pub fn action(&self, id: u32) -> Option<Action> {
        self.table.action(id)
    }
}

#[cfg(test)]
mod tests {
    use super::{Action, PALETTE_DEFAULT, Table, parse};
    use crate::eris_window::shortcut;

    #[test]
    fn the_shortcuts_read_as_the_tauri_plugin_read_them() {
        for text in [
            PALETTE_DEFAULT,
            shortcut::DEFAULT,
            "Escape",
            "Control+Alt+KeyE",
            "Super+Shift+Digit1",
            "cmdorctrl+space",
        ] {
            assert!(parse(text).is_ok(), "{text}");
        }
        assert_eq!(
            parse("CommandOrControl+Shift+Space").unwrap().id(),
            parse(" CmdOrCtrl+Shift+Space ").unwrap().id(),
            "spellings of the same keys are one shortcut"
        );
        for text in ["", "Shift+", "Nope+X", "Alt+Enter+Space"] {
            let why = parse(text).unwrap_err();
            assert!(why.contains("is not a shortcut"), "{text}: {why}");
        }
    }

    #[test]
    fn a_press_is_the_action_holding_its_shortcut() {
        let mut table = Table::default();
        let palette = parse(PALETTE_DEFAULT).unwrap();
        let eris = parse("Alt+Enter").unwrap();
        assert_eq!(table.hold(Action::Palette, palette), None);
        assert_eq!(table.hold(Action::Eris, eris), None);
        assert_eq!(table.action(palette.id()), Some(Action::Palette));
        assert_eq!(table.action(eris.id()), Some(Action::Eris));
        assert_eq!(table.action(parse("Escape").unwrap().id()), None);
        // Eris takes another key: the old one is handed back and no longer hers.
        let other = parse("Control+Alt+KeyE").unwrap();
        assert_eq!(
            table.hold(Action::Eris, other).map(|k| k.id()),
            Some(eris.id())
        );
        assert_eq!(table.action(eris.id()), None);
        assert_eq!(table.action(other.id()), Some(Action::Eris));
        // One shortcut, one action.
        assert_eq!(table.taken(Action::StopComputer, other), Some(Action::Eris));
        assert_eq!(table.taken(Action::Eris, other), None);
        assert_eq!(
            table.release(Action::Eris).map(|k| k.id()),
            Some(other.id())
        );
        assert_eq!(table.action(other.id()), None);
    }
}
