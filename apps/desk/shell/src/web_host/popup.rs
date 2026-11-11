//! A page's popup widget (#156): a `<select>`'s list, a date, time or colour picker, a datalist's
//! suggestions. Off-screen Chromium paints it as an element of its own (`PaintElementType::POPUP`)
//! at a place in the view it names (`on_popup_show`, then `on_popup_size`), and hands it itself the
//! pointer the view gets there and the keys while it is open; a press outside it, Escape and the
//! view's lost focus close it. The render handler attaches its paints as the frames of a surface of
//! their own (`id`: `<surface>#popup`) and tells the compositor where it is in the view
//! (`SurfaceSink::popup`), which draws it over the surface there and sends the pointer on it to the
//! surface at that point. A popup is gone with its browser: a new one starts with none.

use cef::Rect;

/// What a surface's popup attaches its frames as: `<surface>#popup`.
pub fn id(surface: &str) -> String {
    format!("{surface}#popup")
}

/// Where a surface's popup is, in its view's logical (CSS) pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Place {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// One view's popup: whether it is open, where, and its frames' numbers (as `View`'s own).
#[derive(Debug, Default)]
pub struct Popup {
    open: bool,
    place: Option<Place>,
    frame: u64,
    generation: u64,
    last_size: Option<(u32, u32)>,
}

/// What the compositor hears of a change: the popup is at a place, or closed.
pub type Heard = Option<Option<Place>>;

impl Popup {
    /// CEF showed (`open`) or hid it. Hidden, it is closed: its place goes, and its frames with it.
    pub fn shown(&mut self, open: bool) -> Heard {
        let was = self.open;
        self.open = open;
        if open {
            return None;
        }
        self.place = None;
        self.last_size = None;
        was.then_some(None)
    }

    /// CEF placed it at `rect` (the view's pixels): what the compositor hears, while it is open.
    pub fn sized(&mut self, rect: &Rect) -> Heard {
        if !self.open || rect.width <= 0 || rect.height <= 0 {
            return None;
        }
        let place = Place {
            x: rect.x as f32,
            y: rect.y as f32,
            width: rect.width as f32,
            height: rect.height as f32,
        };
        (self.place != Some(place)).then(|| {
            self.place = Some(place);
            Some(place)
        })
    }

    /// The next frame of a `size`-pixel popup texture, its number and generation; none while it is
    /// closed or not placed yet (a paint that comes after it closed is dropped).
    pub fn next_frame(&mut self, size: (u32, u32)) -> Option<(u64, u64)> {
        self.place?;
        if !self.open {
            return None;
        }
        if self.last_size != Some(size) {
            self.last_size = Some(size);
            self.generation += 1;
        }
        self.frame += 1;
        Some((self.frame, self.generation))
    }

    /// Where it is while it is open.
    pub fn place(&self) -> Option<Place> {
        self.place.filter(|_| self.open)
    }
}

#[cfg(test)]
mod tests {
    use super::{Place, Popup, id};
    use cef::Rect;

    fn rect(x: i32, y: i32, width: i32, height: i32) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn a_popup_is_heard_once_placed_and_again_when_it_closes() {
        let mut popup = Popup::default();
        assert_eq!(popup.next_frame((80, 40)), None, "never shown");
        assert_eq!(popup.shown(true), None, "shown, not placed yet");
        assert_eq!(popup.next_frame((80, 40)), None, "nowhere to draw it");
        let place = Place {
            x: 10.0,
            y: 34.0,
            width: 140.0,
            height: 100.0,
        };
        assert_eq!(popup.sized(&rect(10, 34, 140, 100)), Some(Some(place)));
        assert_eq!(popup.sized(&rect(10, 34, 140, 100)), None, "the same place");
        assert_eq!(popup.place(), Some(place));
        assert_eq!(popup.next_frame((280, 200)), Some((1, 1)));
        assert_eq!(popup.next_frame((280, 200)), Some((2, 1)));
        assert_eq!(popup.next_frame((280, 240)), Some((3, 2)), "a new size");
        assert_eq!(popup.shown(false), Some(None), "closed");
        assert_eq!(popup.place(), None);
        assert_eq!(
            popup.next_frame((280, 240)),
            None,
            "a late paint is dropped"
        );
        assert_eq!(popup.shown(false), None, "closed already");
    }

    #[test]
    fn a_popup_reopened_starts_a_new_generation_and_an_empty_place_is_ignored() {
        let mut popup = Popup::default();
        popup.shown(true);
        assert_eq!(popup.sized(&rect(0, 0, 0, 20)), None);
        popup.sized(&rect(0, 0, 50, 20));
        assert_eq!(popup.next_frame((50, 20)), Some((1, 1)));
        popup.shown(false);
        popup.shown(true);
        popup.sized(&rect(0, 0, 50, 20));
        assert_eq!(popup.next_frame((50, 20)), Some((2, 2)), "a fresh texture");
        assert_eq!(
            popup.sized(&rect(5, 0, 50, 20)).flatten().map(|p| p.x),
            Some(5.0)
        );
    }

    #[test]
    fn a_popup_attaches_as_a_surface_of_its_own() {
        assert_eq!(id("main.endue-notes"), "main.endue-notes#popup");
    }
}
