//! Where the floating Eris sits (ADR 0121): one spot per display, kept in `<data>/eris-window.json`,
//! so she comes back where the person left her on each screen. Everything is in physical pixels.
//! A spot is the middle of the window's top edge, from the display's top-left corner, so a window
//! that grows for her composer keeps her figure where it was.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    fn right(self) -> i32 {
        self.x.saturating_add(self.width as i32)
    }

    fn bottom(self) -> i32 {
        self.y.saturating_add(self.height as i32)
    }

    /// The middle of the top edge.
    fn anchor(self) -> (i32, i32) {
        (self.x + (self.width / 2) as i32, self.y)
    }
}

/// A display as the window can use it: its key in the kept file and its work area (the screen
/// less the menu bar, the Dock or the taskbar).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Display {
    pub key: String,
    pub area: Rect,
}

/// Where she sits on one display, from its work area's top-left corner.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Spot {
    pub x: i32,
    pub y: i32,
}

/// The kept spots, by display.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Positions {
    #[serde(default)]
    pub displays: BTreeMap<String, Spot>,
}

impl Positions {
    /// The kept file's spots; a file that cannot be read keeps none, so she starts in the corner.
    pub fn parse(text: &str) -> Self {
        serde_json::from_str(text).unwrap_or_default()
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".to_owned())
    }

    /// Keep where `window` is on `display`; true when that changed what is kept.
    pub fn remember(&mut self, display: &Display, window: Rect) -> bool {
        let (x, y) = window.anchor();
        let spot = Spot {
            x: x - display.area.x,
            y: y - display.area.y,
        };
        self.displays.insert(display.key.clone(), spot) != Some(spot)
    }

    /// Where a window of `size` goes on `display`: on its kept spot, else in the bottom-right
    /// corner `margin` in, and always wholly on the display.
    pub fn place(&self, display: &Display, size: (u32, u32), margin: u32) -> Rect {
        let area = display.area;
        let (width, height) = size;
        let window = match self.displays.get(&display.key) {
            Some(spot) => Rect {
                x: area.x + spot.x - (width / 2) as i32,
                y: area.y + spot.y,
                width,
                height,
            },
            None => Rect {
                x: area.right() - margin as i32 - width as i32,
                y: area.bottom() - margin as i32 - height as i32,
                width,
                height,
            },
        };
        inside(window, area)
    }
}

/// `window` at `size`, keeping the middle of its top edge, moved back onto `area` where the new
/// size would leave it.
pub fn resize(window: Rect, size: (u32, u32), area: Rect) -> Rect {
    let (x, y) = window.anchor();
    let grown = Rect {
        x: x - (size.0 / 2) as i32,
        y,
        width: size.0,
        height: size.1,
    };
    inside(grown, area)
}

/// `window` moved the least to lie on `area`; one larger than `area` keeps its top-left corner on it.
pub fn inside(window: Rect, area: Rect) -> Rect {
    let fit = |start: i32, length: u32, from: i32, to: i32| {
        let end = to - length as i32;
        if end < from {
            from
        } else {
            start.clamp(from, end)
        }
    };
    Rect {
        x: fit(window.x, window.width, area.x, area.right()),
        y: fit(window.y, window.height, area.y, area.bottom()),
        ..window
    }
}

/// A display's key in the kept file: the name the OS gives it and its size, or its position and
/// size when it has no name. Two identical screens side by side keep one spot between them.
pub fn display_key(name: Option<&str>, origin: (i32, i32), size: (u32, u32)) -> String {
    match name.map(str::trim).filter(|n| !n.is_empty()) {
        Some(name) => format!("{name} {}x{}", size.0, size.1),
        None => format!("{},{} {}x{}", origin.0, origin.1, size.0, size.1),
    }
}
