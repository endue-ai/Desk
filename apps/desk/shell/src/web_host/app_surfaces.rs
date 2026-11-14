//! The web host's side of windows out of the canvas (#234, #235, `app_windows.rs`): the surface of
//! a window the window manager has out (`set_out`, from the compositor's plan) shows in an OS
//! window of its own, a windowed browser, instead of an off-screen one. When a window pops out, its
//! off-screen browser closes and the OS window opens at the same document; when it docks, the OS
//! window closes and an off-screen browser opens again, as its `create` asked the first time. The
//! new page says hello and the runtime answers with the state it kept, as after a wake.
//!
//! While out, the surface's `destroy` closes the OS window and every other lifecycle message is
//! dropped: the OS window keeps its own size, shows on its own Space and display, and never sleeps.
//! Its browser is the relay's for the surface's host, so the runtime's posts reach it and its posts
//! reach the runtime as an off-screen surface's do; a new document (`load`) loads in it.

use std::collections::{BTreeMap, HashMap};

use cef::*;
use desk_surface::generated::{CompositorMessage, SurfaceCreate};

use super::WebHost;
use crate::app_windows::{self, Open};

/// A window out of the canvas, as the compositor hands it over: its id, its plugin and its title.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutAsk {
    pub window: String,
    pub plugin: String,
    pub title: String,
}

/// What the host keeps of the surfaces out of the canvas.
#[derive(Default)]
pub(super) struct Apps {
    /// The surfaces whose OS window is open or opening, by host: its browser once it is open.
    open: HashMap<String, Option<Browser>>,
    /// The surfaces the window manager has out now, by host.
    out: BTreeMap<String, OutAsk>,
    /// Each surface's last `create`, to make its off-screen browser again when it docks.
    creates: HashMap<String, SurfaceCreate>,
}

impl Apps {
    /// Whether the surface with host `surface` is out of the canvas, in an OS window of its own.
    pub(super) fn is_out(&self, surface: &str) -> bool {
        self.open.contains_key(surface) || self.out.contains_key(surface)
    }
}

impl WebHost {
    /// Take compositor message `message` about surface `surface` if it is an out window's: whether
    /// it was taken (a `create` of a surface that is out, or anything about one whose OS window is
    /// open).
    pub(super) fn app_message(&self, surface: &str, message: &CompositorMessage) -> bool {
        let mut inner = self.inner();
        let known = inner.apps.open.contains_key(surface);
        match message {
            CompositorMessage::SurfaceCreate(create) => {
                (inner.apps.creates).insert(surface.to_owned(), create.clone());
                let Some(ask) = inner.apps.out.get(surface).cloned().filter(|_| !known) else {
                    return known;
                };
                drop(inner);
                self.open_app(surface, ask);
                true
            }
            CompositorMessage::SurfaceDestroy(_) => {
                inner.apps.creates.remove(surface);
                if !known {
                    return false;
                }
                inner.apps.open.remove(surface);
                drop(inner);
                self.close_app(surface);
                true
            }
            _ => known,
        }
    }

    /// The windows the window manager has out now, by surface host: a surface newly out leaves
    /// its off-screen browser for an OS window, one no longer out goes back off screen.
    pub fn set_out(&self, out: BTreeMap<String, OutAsk>) {
        let (popped, docked) = {
            let mut inner = self.inner();
            if inner.apps.out == out {
                return;
            }
            let popped: Vec<(String, OutAsk)> = (out.iter())
                .filter(|(s, _)| !inner.apps.open.contains_key(*s))
                .map(|(s, ask)| (s.clone(), ask.clone()))
                .collect();
            let docked: Vec<String> = (inner.apps.open.keys())
                .filter(|s| !out.contains_key(*s))
                .cloned()
                .collect();
            inner.apps.out = out;
            (popped, docked)
        };
        for (surface, ask) in popped {
            self.pop_out(&surface, ask);
        }
        for surface in docked {
            self.dock(&surface);
        }
    }

    /// Surface `surface` is out: its off-screen browser, if it has one, closes, and its OS window
    /// opens. One not created yet opens with its `create`.
    fn pop_out(&self, surface: &str, ask: OutAsk) {
        // A web view shows in the desk only (ADR 0216): the window's ends as it moves out.
        self.web_end(surface);
        let browser = {
            let mut inner = self.inner();
            if !inner.apps.creates.contains_key(surface) {
                return;
            }
            inner.records.remove(surface).and_then(|r| r.browser)
        };
        self.relay.surface(surface, None);
        if let Some(host) = browser.as_ref().and_then(|b| b.host()) {
            host.close_browser(1);
        }
        self.open_app(surface, ask);
    }

    /// Surface `surface` docked: its OS window closes and an off-screen browser opens again, as
    /// its last `create` asked (the compositor's next steps size and show it).
    fn dock(&self, surface: &str) {
        let create = {
            let mut inner = self.inner();
            inner.apps.open.remove(surface);
            inner.apps.creates.get(surface).cloned()
        };
        self.close_app(surface);
        if let Some(create) = create {
            self.send(&CompositorMessage::SurfaceCreate(create));
        }
    }

    /// Ask the event loop for surface `surface`'s OS window at its document.
    fn open_app(&self, surface: &str, ask: OutAsk) {
        let url = {
            let mut inner = self.inner();
            let Some(url) = inner.sources.get(surface).cloned() else {
                eprintln!("endue Desk: surface {surface} has no document to show");
                return;
            };
            inner.apps.open.insert(surface.to_owned(), None);
            url
        };
        let open = Open {
            surface: surface.to_owned(),
            window: ask.window,
            plugin: ask.plugin,
            title: ask.title,
            url,
        };
        self.on_event_loop(move |shell, event_loop, host| {
            app_windows::open(shell, event_loop, host, open);
        });
    }

    /// Close surface `surface`'s OS window; its posts no longer go there.
    fn close_app(&self, surface: &str) {
        self.relay.surface(surface, None);
        let surface = surface.to_owned();
        self.on_event_loop(move |shell, _, _| app_windows::close(shell, &surface));
    }

    /// Run `job` on the event loop's thread with this host.
    fn on_event_loop(
        &self,
        job: impl FnOnce(&mut crate::window::Shell, &winit::event_loop::ActiveEventLoop, &WebHost)
        + Send
        + 'static,
    ) {
        let Some(desk) = &self.desk else {
            return;
        };
        let host = self.clone();
        desk.pump
            .run(move |shell, event_loop| job(shell, event_loop, &host));
    }

    /// Out window surface `surface` shows `url` now; whether it is one.
    pub(super) fn app_load(&self, surface: &str, url: &str) -> bool {
        let frame = {
            let inner = self.inner();
            let Some(browser) = inner.apps.open.get(surface) else {
                return false;
            };
            browser.as_ref().and_then(Browser::main_frame)
        };
        if let Some(frame) = frame {
            frame.load_url(Some(&url.into()));
        }
        true
    }

    /// Surface `surface`'s OS window opened with `browser`: its posts go there. Whether the
    /// surface still wants it (one docked or destroyed meanwhile does not).
    pub fn app_opened(&self, surface: &str, browser: Option<Browser>) -> bool {
        {
            let mut inner = self.inner();
            let Some(held) = inner.apps.open.get_mut(surface) else {
                return false;
            };
            held.clone_from(&browser);
        }
        self.relay.surface(surface, browser);
        true
    }

    /// Browser `browser` of surface `surface`'s OS window is gone.
    pub fn app_closed(&self, surface: &str, browser: i32) {
        let mut inner = self.inner();
        let Some(held) = inner.apps.open.get_mut(surface) else {
            return;
        };
        if held.as_ref().is_some_and(|b| b.identifier() == browser) {
            *held = None;
            drop(inner);
            self.relay.surface(surface, None);
        }
    }

    /// The surfaces shown in OS windows, for stats and checks.
    pub fn app_surfaces(&self) -> Vec<String> {
        self.inner().apps.open.keys().cloned().collect()
    }
}
