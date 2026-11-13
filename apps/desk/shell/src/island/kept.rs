//! Where the island sits (ADR 0204): one spot per display, as the floating Eris kept hers
//! (`place`), and the display the person last left it on, so it comes back there after
//! a restart and when that display comes back. Everything is in physical pixels; with no spot kept
//! on a display it sits at the top in the middle of the work area.

use serde::{Deserialize, Serialize};

use super::place::{Display, Positions, Rect, inside};

/// The kept spots and the display they were last left on, as `<data>/island.json` holds them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Kept {
    #[serde(flatten)]
    pub spots: Positions,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last: Option<String>,
}

impl Kept {
    /// The kept file; one that cannot be read keeps nothing, so the island starts at the top.
    pub fn parse(text: &str) -> Self {
        serde_json::from_str(text).unwrap_or_default()
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".to_owned())
    }

    /// The display to show it on: the one the person last left it on while it is connected, else
    /// `fallback` (the one under the pointer).
    pub fn display<'a>(
        &self,
        connected: &'a [Display],
        fallback: Option<&'a Display>,
    ) -> Option<&'a Display> {
        let last = self.last.as_deref();
        connected
            .iter()
            .find(|d| Some(d.key.as_str()) == last)
            .or(fallback)
            .or_else(|| connected.first())
    }

    /// Where the island of `size` goes on `display`: its spot there, else at the top in the middle,
    /// `margin` down; always wholly on the display.
    pub fn place(&self, display: &Display, size: (u32, u32), margin: u32) -> Rect {
        let top = top_middle(display.area, size, margin);
        self.spots.place_or(display, size, top)
    }

    /// The person left it at `window` on `display`: keep it; true when that changed what is kept.
    pub fn remember(&mut self, display: &Display, window: Rect) -> bool {
        let moved = self.spots.remember(display, window);
        let last = self.last.replace(display.key.clone());
        moved || last.as_deref() != Some(display.key.as_str())
    }
}

/// A window of `size` at the top of `area`, in the middle, `margin` down.
pub fn top_middle(area: Rect, size: (u32, u32), margin: u32) -> Rect {
    let x = area.x + (area.width as i32 - size.0 as i32) / 2;
    let window = Rect {
        x,
        y: area.y + margin as i32,
        width: size.0,
        height: size.1,
    };
    inside(window, area)
}
