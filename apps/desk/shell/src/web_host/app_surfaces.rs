//! The web host's side of the app windows (#234, `app_windows.rs`): a surface whose plugin the
//! switch names never gets an off-screen browser. Its `create` asks the event loop for an OS window
//! at the surface's document, its `destroy` closes that window, and every other lifecycle message
//! is dropped: the OS window keeps its own size, shows on its own Space and display, and never
//! sleeps (the live budget still counts it, as its window is still the runtime's). Its browser is
//! the relay's for the surface's host, so the runtime's posts reach it and its posts reach the
//! runtime as an off-screen surface's do; a new document (`load`) loads in it.

use std::collections::HashMap;

use cef::*;
use desk_surface::generated::CompositorMessage;

use super::WebHost;
use crate::app_windows::{self, Open};

/// An app window's surface, by host: its browser once the window is open.
pub(super) type Apps = HashMap<String, Option<Browser>>;

impl WebHost {
    /// Take compositor message `message` about surface `surface` if it is an app window's: whether
    /// it was taken (a `create` for a plugin the switch names, or anything about one opened).
    pub(super) fn app_message(&self, surface: &str, message: &CompositorMessage) -> bool {
        let switch = app_windows::switch();
        if !switch.is_on() {
            return false;
        }
        let mut inner = self.inner();
        let known = inner.apps.contains_key(surface);
        match message {
            CompositorMessage::SurfaceCreate(create)
                if !known && app_windows::handed_surface(&create.plugin, &create.view) =>
            {
                let Some(url) = inner.sources.get(surface).cloned() else {
                    eprintln!("endue Desk: surface {surface} has no document to show");
                    return true;
                };
                inner.apps.insert(surface.to_owned(), None);
                drop(inner);
                let title = app_windows::app(&create.plugin).map(|app| app.name);
                let open = Open {
                    surface: surface.to_owned(),
                    plugin: create.plugin.clone(),
                    title: title.unwrap_or_else(|| create.plugin.clone()),
                    url,
                    size: (create.size.width as u32, create.size.height as u32),
                };
                self.on_event_loop(move |shell, event_loop, host| {
                    app_windows::open(shell, event_loop, host, open);
                });
                true
            }
            CompositorMessage::SurfaceDestroy(_) if known => {
                inner.apps.remove(surface);
                drop(inner);
                self.relay.surface(surface, None);
                let surface = surface.to_owned();
                self.on_event_loop(move |shell, _, _| app_windows::close(shell, &surface));
                true
            }
            _ => known,
        }
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

    /// App window surface `surface` shows `url` now; whether it is one.
    pub(super) fn app_load(&self, surface: &str, url: &str) -> bool {
        let frame = {
            let inner = self.inner();
            let Some(browser) = inner.apps.get(surface) else {
                return false;
            };
            browser.as_ref().and_then(Browser::main_frame)
        };
        if let Some(frame) = frame {
            frame.load_url(Some(&url.into()));
        }
        true
    }

    /// Surface `surface`'s app window opened with `browser`: its posts go there. Whether the
    /// surface still wants it (one destroyed meanwhile does not).
    pub fn app_opened(&self, surface: &str, browser: Option<Browser>) -> bool {
        {
            let mut inner = self.inner();
            let Some(held) = inner.apps.get_mut(surface) else {
                return false;
            };
            held.clone_from(&browser);
        }
        self.relay.surface(surface, browser);
        true
    }

    /// Browser `browser` of surface `surface`'s app window is gone.
    pub fn app_closed(&self, surface: &str, browser: i32) {
        let mut inner = self.inner();
        let Some(held) = inner.apps.get_mut(surface) else {
            return;
        };
        if held.as_ref().is_some_and(|b| b.identifier() == browser) {
            *held = None;
            drop(inner);
            self.relay.surface(surface, None);
        }
    }

    /// The surfaces shown in app windows, for stats and checks.
    pub fn app_surfaces(&self) -> Vec<String> {
        self.inner().apps.keys().cloned().collect()
    }
}
