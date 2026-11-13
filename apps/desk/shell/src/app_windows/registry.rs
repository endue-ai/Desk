//! The app windows the shell holds (#234), keyed by their surface's host: the OS window each sits in
//! (its events find the surface), its browser (its close finds the window), and the windows on their
//! way out. Closing takes three steps, as a `Pane`'s does: the shell asks the browser to close
//! (`ask_close`), the browser agrees (`DoClose`, `agreed`): the window lets go of its view and goes,
//! then the browser is gone (`OnBeforeClose`, `closed`). Generic over the window's key and what is
//! held, so it is tested without a display.

use std::collections::{HashMap, HashSet};
use std::hash::Hash;

/// One open app window.
#[derive(Debug)]
struct Entry<K, P> {
    window: K,
    browser: Option<i32>,
    held: P,
}

/// The app windows, by surface host.
#[derive(Debug)]
pub struct Registry<K, P> {
    open: HashMap<String, Entry<K, P>>,
    /// Which surface each OS window shows.
    windows: HashMap<K, String>,
    /// Asked to close, by browser: held until the browser agrees.
    going: HashMap<i32, P>,
    /// Let go, until their browsers are gone.
    closing: HashSet<i32>,
}

impl<K, P> Default for Registry<K, P> {
    fn default() -> Self {
        Registry {
            open: HashMap::new(),
            windows: HashMap::new(),
            going: HashMap::new(),
            closing: HashSet::new(),
        }
    }
}

impl<K: Copy + Eq + Hash, P> Registry<K, P> {
    /// Surface `surface` shows in OS window `window`, whose browser is `browser`. One it showed in
    /// before is on its way out: its browser, which the caller asks to close (`going`).
    pub fn insert(
        &mut self,
        surface: &str,
        window: K,
        browser: Option<i32>,
        held: P,
    ) -> Option<i32> {
        let replaced = self.ask_close(surface);
        self.windows.insert(window, surface.to_owned());
        let entry = Entry {
            window,
            browser,
            held,
        };
        self.open.insert(surface.to_owned(), entry);
        replaced
    }

    /// The surface OS window `window` shows, while it is open.
    pub fn surface_of(&self, window: K) -> Option<&str> {
        self.windows.get(&window).map(String::as_str)
    }

    /// What is held for surface `surface`, while its window is open.
    pub fn get(&self, surface: &str) -> Option<&P> {
        self.open.get(surface).map(|e| &e.held)
    }

    /// Every surface with an open window.
    pub fn surfaces(&self) -> Vec<String> {
        self.open.keys().cloned().collect()
    }

    /// Surface `surface`'s window is to close: its browser, which the caller asks to close and
    /// finds with `going`. A window with no browser goes at once (`None`).
    pub fn ask_close(&mut self, surface: &str) -> Option<i32> {
        let entry = self.open.remove(surface)?;
        self.windows.remove(&entry.window);
        let browser = entry.browser?;
        self.going.insert(browser, entry.held);
        Some(browser)
    }

    /// What is held for browser `browser`, asked to close.
    pub fn going(&self, browser: i32) -> Option<&P> {
        self.going.get(&browser)
    }

    /// Browser `browser` agreed to close (`DoClose`), asked or by itself: what was held for it, for
    /// the caller to let go of; the browser is closing until `closed`.
    pub fn agreed(&mut self, browser: i32) -> Option<P> {
        let held = self.going.remove(&browser).or_else(|| {
            let surface = (self.open.iter())
                .find(|(_, e)| e.browser == Some(browser))
                .map(|(s, _)| s.clone())?;
            let entry = self.open.remove(&surface)?;
            self.windows.remove(&entry.window);
            Some(entry.held)
        });
        if held.is_some() {
            self.closing.insert(browser);
        }
        held
    }

    /// Browser `browser` is gone (`OnBeforeClose`): anything still held for it, which goes too.
    pub fn closed(&mut self, browser: i32) -> Option<P> {
        self.closing.remove(&browser);
        self.agreed(browser).inspect(|_| {
            self.closing.remove(&browser);
        })
    }

    /// The windows open and on their way out.
    pub fn len(&self) -> usize {
        self.open.len() + self.going.len() + self.closing.len()
    }

    /// No window open and none on its way out.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}
