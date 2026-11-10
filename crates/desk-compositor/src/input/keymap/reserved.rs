//! Chords a binding can never have (ADR 0118, `sequences/reserved.ts`): the operating system takes
//! them first, or the desk holds them as global shortcuts. A sequence with one is reported and stays
//! bound, for whoever turned the system's shortcut off; a cancel key after a prefix can never be
//! pressed, so that sequence is not bound.

use super::chord::Platform;
use super::parse::CANCEL_CHORDS;

/// A chord someone else keeps.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reserved {
    /// The canonical chord.
    pub chord: String,
    /// "macOS", "Windows and Linux" or "the desk".
    pub by: String,
    /// What it does there, as a clause: "quits Desk".
    pub does: String,
    /// The binding can never run (a cancel key after a prefix), so it is not bound.
    pub never: bool,
}

const MAC: [(&str, &str); 13] = [
    ("Meta+Q", "quits Desk"),
    ("Meta+H", "hides Desk"),
    ("Meta+Alt+H", "hides the other apps"),
    ("Meta+M", "minimizes the window"),
    ("Meta+Tab", "switches apps"),
    ("Meta+Shift+Tab", "switches apps"),
    ("Meta+`", "switches the app's windows"),
    ("Meta+Space", "opens Spotlight"),
    ("Meta+Alt+Escape", "force-quits apps"),
    ("Control+Meta+Q", "locks the screen"),
    ("Meta+Shift+3", "takes a screenshot"),
    ("Meta+Shift+4", "takes a screenshot"),
    ("Meta+Shift+5", "takes a screenshot"),
];

const OTHER: [(&str, &str); 7] = [
    ("Alt+Tab", "switches windows"),
    ("Alt+Shift+Tab", "switches windows"),
    ("Alt+F4", "closes the window"),
    ("Control+Alt+Delete", "opens the security screen"),
    ("Meta+L", "locks the screen"),
    ("Meta+D", "shows the desktop"),
    ("Meta+Tab", "switches windows"),
];

fn reserved(chord: &str, by: &str, does: &str) -> Reserved {
    Reserved {
        chord: chord.to_owned(),
        by: by.to_owned(),
        does: does.to_owned(),
        never: false,
    }
}

/// Every chord reserved on `platform`, the desk's global shortcut included.
pub fn reserved_chords(platform: Platform) -> Vec<Reserved> {
    let (os, table): (&str, &[(&str, &str)]) = match platform {
        Platform::Mac => ("macOS", &MAC),
        Platform::Other => ("Windows and Linux", &OTHER),
    };
    let mut all: Vec<Reserved> = table
        .iter()
        .map(|(chord, does)| reserved(chord, os, does))
        .collect();
    // The desk registers CommandOrControl+Shift+Space system-wide to open the palette.
    let palette = match platform {
        Platform::Mac => "Meta+Shift+Space",
        Platform::Other => "Control+Shift+Space",
    };
    all.push(reserved(
        palette,
        "the desk",
        "opens the palette from any app",
    ));
    all
}

/// Why `chords` cannot be bound, if they cannot: a reserved chord, or a cancel key after a prefix.
pub fn reserved_in(chords: &[String], reserved_list: &[Reserved]) -> Option<Reserved> {
    for (i, chord) in chords.iter().enumerate() {
        if let Some(held) = reserved_list.iter().find(|r| &r.chord == chord) {
            return Some(held.clone());
        }
        if i > 0 && CANCEL_CHORDS.contains(&chord.as_str()) {
            return Some(Reserved {
                never: true,
                ..reserved(chord, "the desk", "cancels a pending prefix")
            });
        }
    }
    None
}
