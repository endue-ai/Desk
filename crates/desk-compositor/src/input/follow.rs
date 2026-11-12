//! The keys follow the window in use (ADR 0192, issues 158 #10, 159 #2 #5, 160 #11, 162 #6 #7).
//! The window manager names the surface in use: the one the pane in use of the window in use shows
//! (none for a pane the page draws, or with no window in use). The page says where its own focus
//! rests (`apps/desk/src/compositor-focus.ts`): a surface's place gives that surface the keys, an
//! element of its own (a field, a button) keeps them on the page, and nothing of its own (its body,
//! a window's frame) hands them to the surface in use. A press on the page (a window's title bar,
//! a divider, a grip, the desk) leaves them there too, unless an element of the page's own has them;
//! and when the window in use changes, the keys go along, unless an element of the page's own or a
//! surface of no window (the palette, an edge bar) holds them.

use super::router::{InputRouter, Out};

/// Where the page's own focus rests, as the page says.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum PageFocus {
    /// On nothing of its own: its body, or a window's or a surface's section.
    #[default]
    Rest,
    /// On an element of its own: a field, a button, a list.
    Own,
    /// On plugin surface `0`'s place.
    Place(String),
}

impl InputRouter {
    /// The page's focus moved: the keys go where it rests.
    pub fn page_focus(&mut self, said: PageFocus) -> Vec<Out> {
        self.page = said;
        let to = match &self.page {
            PageFocus::Place(surface) => Some(surface.clone()),
            PageFocus::Own => self.settings.underlay.clone(),
            PageFocus::Rest => self.at_rest(),
        };
        self.focus_now(to.as_deref())
    }

    /// The window manager's surface in use is `surface` now: when it changed and the keys follow
    /// the window in use, they go to it (to the page when it is none).
    pub fn in_use(&mut self, surface: Option<&str>) -> Vec<Out> {
        if self.in_use.as_deref() == surface {
            return Vec::new();
        }
        self.in_use = surface.map(str::to_owned);
        if !self.follows() {
            return Vec::new();
        }
        let to = self.at_rest();
        self.focus_now(to.as_deref())
    }

    /// The surface the window manager names in use, as last told.
    pub fn surface_in_use(&self) -> Option<&str> {
        self.in_use.as_deref()
    }

    /// Where the page's focus rests, as last said.
    pub fn page_rests(&self) -> &PageFocus {
        &self.page
    }

    /// Where the keys go while the page's focus rests on nothing of its own: the surface in use,
    /// else the page.
    fn at_rest(&self) -> Option<String> {
        self.in_use
            .clone()
            .or_else(|| self.settings.underlay.clone())
    }

    /// Whether the keys follow the window in use now: not while an element of the page's own has
    /// them, nor a surface shown outside every window (an overlay such as the palette, an edge bar).
    fn follows(&self) -> bool {
        if self.page == PageFocus::Own {
            return false;
        }
        match self.focus.as_deref() {
            None => true,
            Some(focus) => {
                self.settings.page_owned(focus)
                    || self.targets.in_window(focus)
                    || !self.targets.shown(focus)
            }
        }
    }

    /// The surface a press on `surface` gives the keys to: that surface, but a press on the page or
    /// on a page of its own leaves them where its focus rests (a window's title bar or divider is
    /// its window's) until the page says where the press put them.
    pub(super) fn pressed_keys(&self, surface: &str) -> String {
        let underlay = Some(surface) == self.settings.underlay.as_deref();
        if !self.settings.page_owned(surface) || (underlay && self.page == PageFocus::Own) {
            return surface.to_owned();
        }
        self.at_rest().unwrap_or_else(|| surface.to_owned())
    }

    /// Move the focus to `surface`; the ring is drawn again when it moved.
    fn focus_now(&mut self, surface: Option<&str>) -> Vec<Out> {
        let before = self.focus.clone();
        let mut out = self.focus(surface);
        if self.focus != before {
            out.push(Out::Redraw);
        }
        out
    }
}
