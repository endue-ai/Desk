//! The postMessage relay between the runtime and the plugin surfaces (ADR 0160). The runtime's page
//! (the desk's system surface) holds no frame for a plugin: what its plugin host posts to a surface
//! (`__deskNative.post(text, host)`, `client.rs`) comes here and goes to that surface's own browser,
//! where the page's `window.parent` hears it (`shim.rs`), or to a native plugin's process; what the
//! plugin posts to its parent comes back here and goes to the runtime's page as
//! `__deskNative.onSurface(host, text)`, which the runtime hears as a message from that surface
//! (`packages/runtime/src/pages/remote.ts`). The texts are JSON (structured clones that JSON cannot
//! carry do not cross). Both ends are keyed by the surface's host, `<surface>.<plugin label>`, which
//! only that surface's page has. Nothing loads again when the runtime moves a surface's place in its
//! page (a split, the drawer, a desktop switch): there is no frame to load, so no hello to repeat.
//!
//! Tab crosses here too (#123, #128): the runtime's page tells a surface that its Tab entered the
//! surface's place (`desk:surface-enter`), and the surface's page focuses its first or last control
//! (`shim.js`; a native plugin hears `focus.enter`). A surface's page that tabs past an end is its
//! browser's `OnTakeFocus` (`client.rs`, a native plugin's `focus.leave`), and the runtime's page is
//! told (`desk:surface-leave`); it puts its focus on that edge of the place and asks for one more
//! Tab in the page (`desk:surface-tab`), which leaves the place by the page's own focus order.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use cef::*;
use desk_web::plugin_scheme::hosts::Host;

#[derive(Default)]
struct Tables {
    /// The runtime's page, which hears every surface's messages.
    page: Option<Browser>,
    /// The surface's own browser, by surface host.
    surfaces: HashMap<String, Browser>,
    /// A native plugin's surface instead (#59): its host's way to the process.
    natives: HashMap<String, NativeDown>,
    /// Messages relayed down (to plugins) and up (to the runtime).
    down: u64,
    up: u64,
}

/// The relay's tables, shared by the runtime page's client and every surface's.
#[derive(Clone, Default)]
pub struct Relay(Arc<Mutex<Tables>>);

/// Where the runtime's messages for a native plugin's surface go: its process (`native_host`).
pub type NativeDown = Arc<dyn Fn(String) + Send + Sync>;

/// What the runtime's page hears when a surface's page tabbed past an end (#123).
const LEAVE: &str = "desk:surface-leave";

/// The runtime page's own `desk:surface-tab`: the Tab it wants pressed, `Some(true)` for Shift+Tab.
fn surface_tab(text: &str) -> Option<bool> {
    if !text.contains("desk:surface-tab") {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    (value.get("type")?.as_str()? == "desk:surface-tab")
        .then(|| value.get("back").and_then(serde_json::Value::as_bool) == Some(true))
}

/// The surface host of a `desk-plugin` URL, when it names one.
pub fn surface_host(url: &str) -> Option<String> {
    let rest = url.strip_prefix("desk-plugin://")?;
    let host = rest.split(['/', '?', '#', ':']).next()?;
    matches!(Host::parse(Some(host)), Some(Host::Surface { .. })).then(|| host.to_owned())
}

/// Whether `host` names a plugin surface at all.
fn is_surface(host: &str) -> bool {
    matches!(Host::parse(Some(host)), Some(Host::Surface { .. }))
}

impl Relay {
    fn tables(&self) -> MutexGuard<'_, Tables> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The runtime's page is `browser` (or none: the desk closes).
    pub fn page(&self, browser: Option<Browser>) {
        self.tables().page = browser;
    }

    /// The surface `host` has a browser now (or none: it slept, or is gone).
    pub fn surface(&self, host: &str, browser: Option<Browser>) {
        let mut tables = self.tables();
        match browser {
            Some(browser) => tables.surfaces.insert(host.to_owned(), browser),
            None => tables.surfaces.remove(host),
        };
    }

    /// The surface `host` is a native plugin's, whose page messages `down` takes (or no longer).
    pub fn native(&self, host: &str, down: Option<NativeDown>) {
        let mut tables = self.tables();
        match down {
            Some(down) => tables.natives.insert(host.to_owned(), down),
            None => tables.natives.remove(host),
        };
    }

    /// The runtime posted `text` for surface `host`: to the surface's page. The runtime page's own
    /// Tab past a place (#123) is pressed in that page instead, whose focus it has.
    pub fn down(&self, host: &str, text: String) {
        if !is_surface(host) {
            return;
        }
        if let Some(back) = surface_tab(&text) {
            let page = self.tables().page.clone().and_then(|b| b.host());
            if let Some(page) = page {
                super::input::press_tab(&page, back);
            }
            return;
        }
        let (target, native) = {
            let mut tables = self.tables();
            tables.down += 1;
            let native = tables.natives.get(host).cloned();
            (
                tables.surfaces.get(host).and_then(|b| b.main_frame()),
                native,
            )
        };
        if let Some(native) = native {
            native(text);
            return;
        }
        // A page still loading misses it, as a frame's page did: the SDK's hello starts it over.
        if let Some(target) = target {
            crate::host::send(target, text);
        }
    }

    /// The page of surface `host` posted `text` to its parent: to the runtime's page.
    pub fn up(&self, host: &str, text: String) {
        let page = {
            let mut tables = self.tables();
            tables.up += 1;
            tables.page.as_ref().and_then(|b| b.main_frame())
        };
        if let Some(page) = page {
            crate::host::send_surface(page, host, text);
        }
    }

    /// The page of surface `host` tabbed past its last control (`next`) or before its first: the
    /// runtime's page moves its focus on from the surface's place (#123).
    pub fn leave(&self, host: &str, next: bool) {
        let page = self.tables().page.as_ref().and_then(|b| b.main_frame());
        if let Some(page) = page {
            let text = serde_json::json!({ "type": LEAVE, "next": next });
            crate::host::send_surface(page, host, text.to_string());
        }
    }

    /// Messages relayed so far: (down to plugins, up to the runtime).
    pub fn counts(&self) -> (u64, u64) {
        let tables = self.tables();
        (tables.down, tables.up)
    }
}

#[cfg(test)]
mod tests {
    use super::{is_surface, surface_host, surface_tab};

    #[test]
    fn only_the_runtime_pages_own_tab_is_pressed_in_the_page() {
        let tab = |text: &str| surface_tab(text);
        assert_eq!(
            tab(r#"{"type":"desk:surface-tab","back":true}"#),
            Some(true)
        );
        assert_eq!(
            tab(r#"{"type":"desk:surface-tab","back":false}"#),
            Some(false)
        );
        assert_eq!(tab(r#"{"type":"desk:surface-tab"}"#), Some(false));
        assert_eq!(
            tab(r#"{"type":"desk:state","note":"desk:surface-tab"}"#),
            None,
            "a runtime message for the plugin that names it"
        );
        assert_eq!(tab("desk:surface-tab"), None);
    }

    #[test]
    fn only_a_plugin_surfaces_own_host_is_relayed() {
        assert_eq!(
            surface_host("desk-plugin://main.endue-notes/endue.notes/ui/index.html?v=3").as_deref(),
            Some("main.endue-notes")
        );
        assert!(is_surface("main.endue-notes"));
        for url in [
            "desk-plugin://localhost/_desk/palette/index.html",
            "desk-app://app/index.html",
            "desk-plugin://nonsense/x",
            "https://main.endue-notes/x",
        ] {
            assert_eq!(surface_host(url), None, "{url}");
        }
        for host in ["localhost", "", "nonsense", "app"] {
            assert!(!is_surface(host), "{host}");
        }
    }
}
