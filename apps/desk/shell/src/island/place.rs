//! Where the island sits (ADR 0204): one spot per display, so it comes back where the person left it
//! on each screen (`kept.rs` keeps them with the display it was last left on). Everything is in
//! physical pixels. A spot is the middle of the window's top edge, from the display's work area's
//! top-left corner, so a window that grows open keeps its top edge where it was. The floating Eris
//! kept hers this way (ADR 0121) before the island took her place.

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
    /// The kept file's spots; a file that cannot be read keeps none.
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

    /// Where a window of `size` goes on `display`: on its kept spot, else at `otherwise`, and
    /// always wholly on the display.
    pub fn place_or(&self, display: &Display, size: (u32, u32), otherwise: Rect) -> Rect {
        let area = display.area;
        let (width, height) = size;
        let window = match self.displays.get(&display.key) {
            Some(spot) => Rect {
                x: area.x + spot.x - (width / 2) as i32,
                y: area.y + spot.y,
                width,
                height,
            },
            None => otherwise,
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

#[cfg(test)]
mod tests {
    use super::{Display, Positions, Rect, display_key, inside, resize};

    fn display(key: &str, x: i32, y: i32) -> Display {
        Display {
            key: key.to_owned(),
            area: Rect {
                x,
                y,
                width: 2000,
                height: 1200,
            },
        }
    }

    const CORNER: Rect = Rect {
        x: 0,
        y: 0,
        width: 300,
        height: 400,
    };

    #[test]
    fn a_spot_is_kept_per_display_and_moves_with_its_display() {
        let laptop = display("Built-in 2000x1200", 0, 0);
        let monitor = display("DELL U2723QE 2000x1200", 2000, 0);
        let mut kept = Positions::default();
        // Never moved: where the caller says.
        assert_eq!(kept.place_or(&laptop, (300, 400), CORNER), CORNER);
        let on_laptop = Rect {
            x: 100,
            y: 200,
            width: 300,
            height: 400,
        };
        let on_monitor = Rect {
            x: 2600,
            y: 50,
            ..on_laptop
        };
        assert!(kept.remember(&laptop, on_laptop));
        assert!(kept.remember(&monitor, on_monitor));
        assert!(!kept.remember(&monitor, on_monitor), "the same spot again");
        assert_eq!(kept.place_or(&laptop, (300, 400), CORNER), on_laptop);
        assert_eq!(kept.place_or(&monitor, (300, 400), CORNER), on_monitor);
        // Kept across a restart.
        let again = Positions::parse(&kept.to_json());
        assert_eq!(again, kept);
        // A monitor moved to the left keeps its spot on it.
        let moved = display("DELL U2723QE 2000x1200", -2000, 0);
        let spot = again.place_or(&moved, (300, 400), CORNER);
        assert_eq!((spot.x, spot.y), (600 - 2000, 50));
    }

    #[test]
    fn a_kept_spot_off_the_display_is_brought_back_onto_it() {
        let small = Display {
            key: "Projector 800x600".to_owned(),
            area: Rect {
                x: 0,
                y: 0,
                width: 800,
                height: 600,
            },
        };
        let mut kept = Positions::default();
        let far = Rect {
            x: 1700,
            y: 900,
            width: 300,
            height: 400,
        };
        kept.remember(&display("Projector 800x600", 0, 0), far);
        let placed = kept.place_or(&small, (300, 400), CORNER);
        assert_eq!((placed.x, placed.y), (500, 200));
        assert_eq!(Positions::parse("not json"), Positions::default());
    }

    #[test]
    fn growing_open_keeps_the_top_edge_in_place() {
        let area = Rect {
            x: 0,
            y: 0,
            width: 2000,
            height: 1200,
        };
        let pill = Rect {
            x: 900,
            y: 100,
            width: 200,
            height: 240,
        };
        let open = resize(pill, (400, 600), area);
        assert_eq!(
            (open.x, open.y, open.width, open.height),
            (800, 100, 400, 600)
        );
        // Near the bottom-right corner it grows onto the display instead.
        let corner = Rect {
            x: 1790,
            y: 950,
            ..pill
        };
        let open = resize(corner, (400, 600), area);
        assert_eq!((open.x, open.y), (1600, 600));
        let larger = inside(
            Rect {
                x: -50,
                y: -50,
                width: 3000,
                height: 100,
            },
            area,
        );
        assert_eq!((larger.x, larger.y), (0, 0));
    }

    #[test]
    fn display_keys_name_the_screen() {
        assert_eq!(
            display_key(Some("Built-in Retina Display"), (0, 0), (3024, 1964)),
            "Built-in Retina Display 3024x1964"
        );
        assert_eq!(
            display_key(None, (-1920, 0), (1920, 1080)),
            "-1920,0 1920x1080"
        );
        assert_eq!(display_key(Some(" "), (0, 0), (800, 600)), "0,0 800x600");
    }
}
