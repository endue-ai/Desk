//! What an app's manifest asks of its window (`SurfaceWindow` in `specs/plugin/v0`, ADR 0226), for
//! its OS window: the size its page first opens with, the smallest the person can make it, and
//! whether the person can resize it. The window manager reads the same hints for the window on the
//! canvas (`desk-wm`'s `hints.rs`), so an app opens alike in the desk and out of it.

use desk_bridge::SurfaceWindow;

use super::{MIN, OPENS};

/// An app window's hints, in points.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Hints {
    pub size: Option<(f64, f64)>,
    pub min: Option<(f64, f64)>,
    pub fixed: bool,
}

impl Hints {
    pub fn of(window: Option<&SurfaceWindow>) -> Hints {
        let size = |s: &desk_bridge::WindowSize| (s.width as f64, s.height as f64);
        Hints {
            size: window.and_then(|w| w.size.as_ref()).map(size),
            min: window.and_then(|w| w.min_size.as_ref()).map(size),
            fixed: window.is_some_and(|w| w.resizable == Some(false)),
        }
    }

    /// The smallest the window's inside gets: what the app asks, else the desk's own (`MIN`).
    pub fn least(&self) -> (f64, f64) {
        self.min.unwrap_or(MIN)
    }

    /// The size the window's inside opens with. Where it was last (`kept`) comes first, then what
    /// the app asks, then the size its window had on the canvas (`canvas`) and at least `OPENS`;
    /// a window that keeps its size opens as its app asks whatever was kept. Never under `least`.
    pub fn first(&self, kept: Option<(f64, f64)>, canvas: Option<(f64, f64)>) -> (f64, f64) {
        let own = || {
            let (w, h) = canvas.unwrap_or(OPENS);
            (w.max(OPENS.0), h.max(OPENS.1))
        };
        let (w, h) = if self.fixed {
            self.size.or(kept).unwrap_or_else(own)
        } else {
            kept.or(self.size).unwrap_or_else(own)
        };
        let least = self.least();
        (w.max(least.0), h.max(least.1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hints(text: &str) -> Hints {
        let window: SurfaceWindow = serde_json::from_str(text).expect("a window block");
        Hints::of(Some(&window))
    }

    #[test]
    fn an_app_without_hints_opens_as_the_desk_always_opened_it() {
        let none = Hints::of(None);
        assert_eq!(none, Hints::default());
        assert_eq!(none.least(), MIN);
        assert_eq!(none.first(None, None), OPENS);
        assert_eq!(none.first(None, Some((400.0, 300.0))), OPENS);
        assert_eq!(none.first(None, Some((900.0, 700.0))), (900.0, 700.0));
        assert_eq!(none.first(Some((500.0, 320.0)), None), (500.0, 320.0));
    }

    #[test]
    fn an_app_opens_at_the_size_it_asks_and_then_where_it_was_last() {
        let app = hints(r#"{"size":{"width":480,"height":360}}"#);
        assert_eq!(app.first(None, Some((482.0, 402.0))), (480.0, 360.0));
        assert_eq!(app.first(Some((640.0, 500.0)), None), (640.0, 500.0));
    }

    #[test]
    fn the_smallest_size_an_app_asks_is_its_windows_and_its_first_size_is_never_under_it() {
        let app =
            hints(r#"{"size":{"width":300,"height":200},"minSize":{"width":400,"height":300}}"#);
        assert_eq!(app.least(), (400.0, 300.0));
        assert_eq!(app.first(None, None), (400.0, 300.0));
        assert_eq!(app.first(Some((320.0, 200.0)), None), (400.0, 300.0));
    }

    #[test]
    fn a_window_that_keeps_its_size_opens_as_its_app_asks_whatever_was_kept() {
        let app = hints(r#"{"size":{"width":480,"height":360},"resizable":false}"#);
        assert!(app.fixed);
        assert_eq!(app.first(Some((900.0, 700.0)), None), (480.0, 360.0));
        assert!(!hints(r#"{"resizable":true}"#).fixed);
    }
}
