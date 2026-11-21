//! What the app's menu bar holds on macOS, in a language (ADR 0276): the app menu, Edit and Window,
//! each item in the shell's words (`words.rs`). The items AppKit runs (Hide, Copy, Minimize, …) are
//! named here too, so the whole bar speaks the desk's language; the ones AppKit adds by itself
//! (Start Dictation, Emoji & Symbols, the windows' titles) are its own. `menu.rs` makes the menus
//! from this and re-words them in place when the language changes.

use super::Choice;
use crate::words::{Language, text};

/// The app menu's title: the app's name, which AppKit shows in bold whatever it is.
pub const APP: &str = "endue Desk";

/// One of the items AppKit runs (muda's `PredefinedMenuItem`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Standard {
    About,
    Services,
    Hide,
    HideOthers,
    ShowAll,
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Minimize,
    CloseWindow,
}

/// One row of a menu.
#[derive(Clone, Debug, PartialEq)]
pub enum Entry {
    /// The desk's own item: what it does, its words and its key.
    Item {
        choice: Choice,
        text: String,
        keys: Option<&'static str>,
    },
    /// One AppKit runs, in the desk's words.
    Standard {
        kind: Standard,
        text: String,
    },
    Separator,
}

impl Entry {
    /// Its words; a separator has none.
    pub fn text(&self) -> Option<&str> {
        match self {
            Entry::Item { text, .. } | Entry::Standard { text, .. } => Some(text),
            Entry::Separator => None,
        }
    }
}

/// One menu of the bar: its title and its rows.
#[derive(Clone, Debug, PartialEq)]
pub struct Section {
    pub title: String,
    pub entries: Vec<Entry>,
}

/// The menu bar in `language`: the app menu (About, Services, Hide, Quit), Edit and Window.
pub fn bar(language: Language) -> Vec<Section> {
    let say = |name: &str| text(language, &format!("desk.menu.{name}"));
    let standard = |kind, name: &str| Entry::Standard {
        kind,
        text: say(name),
    };
    let item = |choice, name: &str, keys| Entry::Item {
        choice,
        text: say(name),
        keys: Some(keys),
    };
    use Standard as S;
    let app = vec![
        standard(S::About, "about"),
        Entry::Separator,
        standard(S::Services, "services"),
        Entry::Separator,
        standard(S::Hide, "hide"),
        standard(S::HideOthers, "hideOthers"),
        standard(S::ShowAll, "showAll"),
        Entry::Separator,
        item(Choice::Quit, "quit", "CmdOrCtrl+Q"),
    ];
    let edit = vec![
        standard(S::Undo, "undo"),
        standard(S::Redo, "redo"),
        Entry::Separator,
        standard(S::Cut, "cut"),
        standard(S::Copy, "copy"),
        standard(S::Paste, "paste"),
        standard(S::SelectAll, "selectAll"),
    ];
    // An OS window a window popped out into goes back to the desk (#235); on the desk's own window
    // it does nothing.
    let window = vec![
        standard(S::Minimize, "minimize"),
        item(Choice::Dock, "dock", "CmdOrCtrl+Shift+Backslash"),
        standard(S::CloseWindow, "closeWindow"),
    ];
    vec![
        Section {
            title: APP.to_owned(),
            entries: app,
        },
        Section {
            title: say("edit"),
            entries: edit,
        },
        Section {
            title: say("window"),
            entries: window,
        },
    ]
}

/// Every text of the bar in order, each menu's title before its rows: what re-wording sets.
pub fn texts(language: Language) -> Vec<String> {
    (bar(language).into_iter())
        .flat_map(|section| {
            let rows = section.entries.into_iter();
            std::iter::once(section.title).chain(rows.filter_map(|e| e.text().map(str::to_owned)))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{Language, bar, texts};

    #[test]
    fn every_language_words_every_place_and_reads_no_id() {
        for language in Language::ALL {
            let all = texts(language);
            let places: usize = bar(language)
                .iter()
                .map(|s| 1 + s.entries.iter().filter(|e| e.text().is_some()).count())
                .sum();
            assert_eq!(all.len(), places);
            assert_eq!(all.len(), texts(Language::En).len());
            assert!(
                all.iter().all(|t| !t.is_empty() && !t.starts_with("desk.")),
                "{all:?}"
            );
        }
    }
}
