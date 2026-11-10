//! The postMessage relay between the runtime and the off-screen plugin surfaces (compositor mode).
//! The runtime keeps its plugin host and window manager in the shell page (#53 moves the window
//! manager), so each plugin frame there is a stand-in (`stand_in.rs`) at the plugin surface's URL:
//! what the runtime posts to it comes here (`desk.post`) and goes to the surface's own browser, where
//! the page's `window.parent` hears it (`shim.rs`); what the plugin posts to its parent comes back
//! here and the stand-in posts it to the runtime, which sees it come from that frame as before. The
//! texts are JSON (structured clones that JSON cannot carry do not cross). Both ends are keyed by the
//! surface's host, `<surface>.<plugin label>`, which only that surface's frames have.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use cef::*;
use desk_web::plugin_scheme::hosts::Host;

/// What a plugin posts before its stand-in has loaded waits, up to this many messages.
const MOST_WAITING: usize = 256;

#[derive(Default)]
struct Tables {
    /// The stand-in frame in the shell page, by surface host, once it has loaded.
    stand_ins: HashMap<String, Frame>,
    /// The surface's own browser, by surface host.
    surfaces: HashMap<String, Browser>,
    /// The plugin's messages for the runtime while its stand-in loads.
    waiting: HashMap<String, Vec<String>>,
    /// Messages relayed down (to plugins) and up (to the runtime).
    down: u64,
    up: u64,
}

/// The relay's tables, shared by the shell page's client and every surface's.
#[derive(Clone, Default)]
pub struct Relay(Arc<Mutex<Tables>>);

/// The surface host of a `desk-plugin` URL, when it names one.
pub fn surface_host(url: &str) -> Option<String> {
    let rest = url.strip_prefix("desk-plugin://")?;
    let host = rest.split(['/', '?', '#', ':']).next()?;
    matches!(Host::parse(Some(host)), Some(Host::Surface { .. })).then(|| host.to_owned())
}

impl Relay {
    fn tables(&self) -> MutexGuard<'_, Tables> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The surface `host` has a browser now (or none: it slept, or is gone).
    pub fn surface(&self, host: &str, browser: Option<Browser>) {
        let mut tables = self.tables();
        match browser {
            Some(browser) => tables.surfaces.insert(host.to_owned(), browser),
            None => tables.surfaces.remove(host),
        };
    }

    /// A stand-in starts loading: what comes for it waits until it has loaded.
    pub fn stand_in_loading(&self, url: &str) {
        if let Some(host) = surface_host(url) {
            self.tables().stand_ins.remove(&host);
        }
    }

    /// A stand-in loaded in `frame`: it takes what waited for it, in order.
    pub fn stand_in_loaded(&self, frame: &Frame) {
        let url = CefString::from(&frame.url()).to_string();
        let Some(host) = surface_host(&url) else {
            return;
        };
        let waiting = {
            let mut tables = self.tables();
            tables.stand_ins.insert(host.clone(), frame.clone());
            tables.waiting.remove(&host).unwrap_or_default()
        };
        for text in waiting {
            crate::host::send(frame.clone(), text);
        }
    }

    /// The runtime posted `text` to the stand-in `frame`: to the surface's page.
    pub fn down(&self, frame: &Frame, text: String) {
        let url = CefString::from(&frame.url()).to_string();
        let Some(host) = surface_host(&url) else {
            return;
        };
        let target = {
            let mut tables = self.tables();
            tables.down += 1;
            tables.surfaces.get(&host).and_then(|b| b.main_frame())
        };
        // A page still loading misses it, as a frame's page did: the SDK's hello starts it over.
        if let Some(target) = target {
            crate::host::send(target, text);
        }
    }

    /// The page of surface `host` posted `text` to its parent: to the runtime, through the stand-in.
    pub fn up(&self, host: &str, text: String) {
        let target = {
            let mut tables = self.tables();
            tables.up += 1;
            match tables.stand_ins.get(host).filter(|f| f.is_valid() == 1) {
                Some(frame) => Some(frame.clone()),
                None => {
                    let waiting = tables.waiting.entry(host.to_owned()).or_default();
                    if waiting.len() < MOST_WAITING {
                        waiting.push(text.clone());
                    }
                    None
                }
            }
        };
        if let Some(frame) = target {
            crate::host::send(frame, text);
        }
    }

    /// Messages relayed so far: (down to plugins, up to the runtime).
    pub fn counts(&self) -> (u64, u64) {
        let tables = self.tables();
        (tables.down, tables.up)
    }
}

wrap_load_handler! {
    // The shell page's loads in compositor mode: a stand-in that starts or ends loading.
    pub struct StandInLoads {
        relay: Relay,
    }

    impl LoadHandler {
        fn on_load_start(
            &self,
            _browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            _transition_type: TransitionType,
        ) {
            if let Some(frame) = frame.filter(|f| f.is_main() != 1) {
                self.relay.stand_in_loading(&CefString::from(&frame.url()).to_string());
            }
        }

        fn on_load_end(
            &self,
            _browser: Option<&mut Browser>,
            frame: Option<&mut Frame>,
            _http_status_code: ::std::os::raw::c_int,
        ) {
            if let Some(frame) = frame.filter(|f| f.is_main() != 1) {
                self.relay.stand_in_loaded(frame);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::surface_host;

    #[test]
    fn only_a_plugin_surfaces_own_host_is_relayed() {
        assert_eq!(
            surface_host("desk-plugin://main.endue-notes/endue.notes/ui/index.html?v=3").as_deref(),
            Some("main.endue-notes")
        );
        for url in [
            "desk-plugin://localhost/_desk/palette/index.html",
            "desk-app://app/index.html",
            "desk-plugin://nonsense/x",
            "https://main.endue-notes/x",
        ] {
            assert_eq!(surface_host(url), None, "{url}");
        }
    }
}
