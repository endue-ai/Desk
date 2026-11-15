//! The keys follow the window in use (ADR 0192), and the window manager is the one that says which
//! it is (#251, ADR 0230). The window manager names the surface in use: the one the pane in use of
//! the window in use shows (none for a pane the page draws, or with no window in use). It decides
//! that on a press before the press is routed, and for a key, a command or an agent's call when it
//! applies them; the keys go there at once ([`InputRouter::decided`]), and nothing waits for the
//! page to agree. The page says only what its own fields hold (`apps/desk/src/compositor-focus.ts`):
//! an element of its own (a field, a button) keeps the keys on the page, and a surface it shows
//! outside every window (the palette, a question, an edge bar) has them while its place has the
//! page's focus. Its focus on a window's surface says nothing: that is the window manager's word.
//! A press on the page (the desk, a bar of the system layer) leaves the keys where they are, unless
//! an element of the page's own has them.

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
    /// The page's focus moved: the keys go where it rests. Its focus on the place of a plugin
    /// surface a window shows is no claim: which window is in use is the window manager's to say.
    /// A window's own page with a field of its own focused is one, as the page's own is.
    pub fn page_focus(&mut self, said: PageFocus) -> Vec<Out> {
        self.page = match said {
            PageFocus::Place(surface)
                if !self.settings.page_owned(&surface) && self.targets.in_window(&surface) =>
            {
                PageFocus::Rest
            }
            said => said,
        };
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

    /// The window manager put another window or pane in use (a press, a key, a command, an agent's
    /// call): the keys go to the surface it shows, `surface`, at once. What the page said of a field
    /// of its own no longer holds, since the page follows; only a surface shown outside every window
    /// (an overlay, an edge bar) keeps the keys it has, over the window in use.
    pub fn decided(&mut self, surface: Option<&str>) -> Vec<Out> {
        self.in_use = surface.map(str::to_owned);
        if self.outside() {
            return Vec::new();
        }
        self.page = PageFocus::Rest;
        let to = self.at_rest();
        self.focus_now(to.as_deref())
    }

    /// The window manager took the next press as a window's and decided the keys for it: nothing
    /// typed after it waits for the page (`hold.rs`).
    pub fn window_pressed(&mut self) {
        self.window_press = true;
    }

    /// Whether the keys are with a surface shown outside every window.
    fn outside(&self) -> bool {
        self.focus.as_deref().is_some_and(|focus| {
            !self.settings.page_owned(focus)
                && !self.targets.in_window(focus)
                && self.targets.shown(focus)
        })
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

    /// The surface a press on `surface` gives the keys to. A window's surface: the one the window
    /// manager has in use, which it decided for this press before it was routed (the pressed
    /// surface itself where no window manager said). A surface outside every window (an overlay, an
    /// edge bar): that surface. The page or a page of its own: where its focus rests (a window's
    /// title bar or divider is its window's) until the page says where the press put them.
    pub(super) fn pressed_keys(&self, surface: &str) -> String {
        let underlay = Some(surface) == self.settings.underlay.as_deref();
        if !self.settings.page_owned(surface) {
            let decided = self
                .in_use
                .clone()
                .filter(|_| self.targets.in_window(surface));
            return decided.unwrap_or_else(|| surface.to_owned());
        }
        if underlay && self.page == PageFocus::Own {
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
