//! The text field's menu without CEF (#156): its items for the field's edit state, where it goes
//! in the page's view, and what it makes of each input while it is open. The shell decides every
//! press on it from this geometry, never from the page, which only shows it (`field_menu.js`).

use serde_json::{Value, json};

/// CEF's command ids (`cef_menu_id_t`): what the menu's callback continues with.
pub const UNDO: i32 = 110;
pub const REDO: i32 = 111;
pub const CUT: i32 = 112;
pub const COPY: i32 = 113;
pub const PASTE: i32 = 114;
pub const SELECT_ALL: i32 = 117;

/// CEF's edit state bits (`cef_context_menu_edit_state_flags_t`).
const CAN_UNDO: u32 = 1;
const CAN_REDO: u32 = 2;
const CAN_CUT: u32 = 4;
const CAN_COPY: u32 = 8;
const CAN_PASTE: u32 = 16;
const CAN_SELECT_ALL: u32 = 64;

/// Its width, a row's height, a separator's and the padding above and below the rows: CSS pixels.
pub const WIDTH: f64 = 200.0;
pub const ROW: f64 = 24.0;
pub const SEPARATOR: f64 = 9.0;
pub const PAD: f64 = 5.0;

/// One row of the menu.
#[derive(Clone, Debug, PartialEq)]
pub enum Entry {
    Item {
        label: &'static str,
        keys: &'static str,
        command: i32,
        enabled: bool,
    },
    Separator,
}

impl Entry {
    fn enabled(&self) -> bool {
        matches!(self, Entry::Item { enabled: true, .. })
    }
}

/// The items of an editable field with `flags` (CEF's edit state), with the Mac's key glyphs on
/// `mac` and Ctrl+ elsewhere.
pub fn field(flags: u32, mac: bool) -> Vec<Entry> {
    let item = |label, mac_keys, keys, command, bit: u32| Entry::Item {
        label,
        keys: if mac { mac_keys } else { keys },
        command,
        enabled: flags & bit != 0,
    };
    vec![
        item("Undo", "⌘Z", "Ctrl+Z", UNDO, CAN_UNDO),
        item("Redo", "⇧⌘Z", "Ctrl+Shift+Z", REDO, CAN_REDO),
        Entry::Separator,
        item("Cut", "⌘X", "Ctrl+X", CUT, CAN_CUT),
        item("Copy", "⌘C", "Ctrl+C", COPY, CAN_COPY),
        item("Paste", "⌘V", "Ctrl+V", PASTE, CAN_PASTE),
        Entry::Separator,
        item("Select All", "⌘A", "Ctrl+A", SELECT_ALL, CAN_SELECT_ALL),
    ]
}

/// The item of text selected outside a field: Copy.
pub fn selection(mac: bool) -> Vec<Entry> {
    vec![Entry::Item {
        label: "Copy",
        keys: if mac { "⌘C" } else { "Ctrl+C" },
        command: COPY,
        enabled: true,
    }]
}

/// The menu laid out in a view: its box and each row's top and height, in the view's CSS pixels.
#[derive(Clone, Debug, PartialEq)]
pub struct Placed {
    pub entries: Vec<Entry>,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub rows: Vec<(f64, f64)>,
}

/// Lay `entries` out for a press at `at` in a view of `view`: below and right of the pointer, or
/// above or left of it where the view has no room, and inside the view as far as it fits.
pub fn place(entries: Vec<Entry>, at: (f64, f64), view: (f64, f64)) -> Placed {
    let mut rows = Vec::with_capacity(entries.len());
    let mut top = PAD;
    for entry in &entries {
        let h = if *entry == Entry::Separator {
            SEPARATOR
        } else {
            ROW
        };
        rows.push((top, h));
        top += h;
    }
    let (w, h) = (WIDTH, top + PAD);
    let side = |at: f64, size: f64, room: f64| {
        let start = if at + 1.0 + size <= room {
            at + 1.0
        } else {
            at - size
        };
        start.min(room - size).max(0.0)
    };
    Placed {
        x: side(at.0, w, view.0),
        y: side(at.1, h, view.1),
        w,
        h,
        rows,
        entries,
    }
}

impl Placed {
    /// Whether the view's point is on the menu.
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h
    }

    /// The enabled item at the view's point.
    pub fn item_at(&self, x: f64, y: f64) -> Option<usize> {
        if !self.contains(x, y) {
            return None;
        }
        let local = y - self.y;
        let row = self
            .rows
            .iter()
            .position(|(top, h)| local >= *top && local < top + h)?;
        self.entries[row].enabled().then_some(row)
    }

    /// The enabled item after `from` (before it, with `back`), or the first (last) one.
    pub fn step(&self, from: Option<usize>, back: bool) -> Option<usize> {
        let enabled = |i: &usize| self.entries[*i].enabled();
        let n = self.entries.len();
        match (from, back) {
            (None, false) => (0..n).find(enabled),
            (None, true) => (0..n).rev().find(enabled),
            (Some(i), false) => (i + 1..n).find(enabled).or(Some(i)),
            (Some(i), true) => (0..i).rev().find(enabled).or(Some(i)),
        }
    }

    /// The command of item `row`, if it is an enabled one.
    pub fn command(&self, row: usize) -> Option<i32> {
        match self.entries.get(row) {
            Some(Entry::Item {
                command,
                enabled: true,
                ..
            }) => Some(*command),
            _ => None,
        }
    }

    /// What `field_menu.js` draws, with row `hover` highlighted.
    pub fn spec(&self, hover: Option<usize>) -> Value {
        let rows: Vec<Value> = (self.entries.iter().zip(&self.rows))
            .map(|(entry, (top, h))| match entry {
                Entry::Separator => json!({ "top": top, "h": h, "separator": true }),
                Entry::Item {
                    label,
                    keys,
                    enabled,
                    ..
                } => json!({ "top": top, "h": h, "label": label, "keys": keys,
                    "enabled": enabled }),
            })
            .collect();
        json!({ "x": self.x, "y": self.y, "w": self.w, "h": self.h, "rows": rows,
            "hover": hover.map_or(-1, |h| h as i64) })
    }
}

/// An input while the menu is open, in the view's CSS pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Input<'a> {
    Move(f64, f64),
    Down {
        x: f64,
        y: f64,
        right: bool,
    },
    Up {
        x: f64,
        y: f64,
        right: bool,
    },
    Wheel,
    Leave,
    Key(&'a str),
    /// A key's release, which goes to the page (it may have gone down before the menu opened).
    KeyUp,
    /// Text, a composition or anything else a pressed key brings: the menu's.
    Typed,
    /// The page lost the keys: the menu goes.
    Blur,
}

/// What the shell does with an input.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Then {
    /// The page has it.
    Pass,
    /// The menu has it; nothing shows differently.
    Take,
    /// The menu has it and draws its highlight again.
    Redraw,
    /// The person chose this command: the menu goes and it runs.
    Choose(i32),
    /// The menu goes, nothing chosen; the input is the menu's unless it is the page's blur.
    Dismiss,
}

/// The menu while it shows: which row is highlighted, and whether the pointer left the place it
/// opened at (a press held on the menu's opening place chooses when it is let go on an item).
#[derive(Clone, Debug, PartialEq)]
pub struct Open {
    pub placed: Placed,
    pub hover: Option<usize>,
    at: (f64, f64),
    dragged: bool,
}

impl Open {
    pub fn new(placed: Placed, at: (f64, f64)) -> Open {
        Open {
            placed,
            hover: None,
            at,
            dragged: false,
        }
    }

    /// Hear `input`.
    pub fn hear(&mut self, input: Input<'_>) -> Then {
        match input {
            Input::Move(x, y) => {
                self.dragged |= (x - self.at.0).abs() > 3.0 || (y - self.at.1).abs() > 3.0;
                self.hover_to(self.placed.item_at(x, y))
            }
            Input::Leave => self.hover_to(None),
            Input::Down { x, y, .. } if self.placed.contains(x, y) => Then::Take,
            Input::Down { .. } | Input::Wheel => Then::Dismiss,
            // The release of the press that opened the menu, where it opened: the menu stays.
            Input::Up { right: true, .. } if !self.dragged => Then::Take,
            Input::Up { x, y, right } => match self.placed.item_at(x, y) {
                Some(row) => self.placed.command(row).map_or(Then::Take, Then::Choose),
                None if right => Then::Dismiss,
                None => Then::Take,
            },
            Input::Key("Escape") => Then::Dismiss,
            Input::Key("ArrowDown") => self.hover_to(self.placed.step(self.hover, false)),
            Input::Key("ArrowUp") => self.hover_to(self.placed.step(self.hover, true)),
            Input::Key("Enter" | "NumpadEnter" | " " | "Space") => {
                match self.hover.and_then(|row| self.placed.command(row)) {
                    Some(command) => Then::Choose(command),
                    None => Then::Take,
                }
            }
            Input::Key(_) | Input::Typed => Then::Take,
            Input::KeyUp => Then::Pass,
            Input::Blur => Then::Dismiss,
        }
    }

    fn hover_to(&mut self, row: Option<usize>) -> Then {
        if row == self.hover {
            return Then::Take;
        }
        self.hover = row;
        Then::Redraw
    }
}

#[cfg(test)]
#[path = "field_menu_model_tests.rs"]
mod tests;
