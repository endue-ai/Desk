//! The postMessage relay between the runtime and the off-screen plugin surfaces (compositor mode).
//! The runtime keeps its plugin host and window manager in the shell page (#53 moves the window
//! manager), so each plugin frame there is a stand-in (`stand_in.rs`) at the plugin surface's URL:
//! what the runtime posts to it comes here (`desk.post`) and goes to the surface's own browser, where
//! the page's `window.parent` hears it (`shim.rs`); what the plugin posts to its parent comes back
//! here and the stand-in posts it to the runtime, which sees it come from that frame as before. The
//! texts are JSON (structured clones that JSON cannot carry do not cross). Both ends are keyed by the
//! surface's host, `<surface>.<plugin label>`, which only that surface's frames have.
//!
//! The page moves a frame when it splits a window, puts it away or shows another desktop, and a
//! moved frame loads again; the surface does not (#81). So a stand-in that loads while its surface's
//! page has already said hello says it again on the page's behalf: the runtime greets the moved
//! frame as it would a reloaded one, and the plugin, which never reloaded, is not handed a second
//! `desk:init`.
//!
//! Tab crosses here too (#123): a stand-in the shell page's Tab entered tells its surface's page
//! (`desk:stand-in-enter`), which focuses its first or last control (`shim.js`); a surface's page
//! that tabs past an end is its browser's `OnTakeFocus` (`client.rs`), and the stand-in is told
//! (`desk:stand-in-leave`); it puts the page's focus on that edge and asks for one more Tab in the
//! shell page (`desk:stand-in-tab`), which leaves the frame by the page's own focus order.

use std::collections::{HashMap, HashSet};
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
    /// A native plugin's surface instead (#59): its host's way to the process.
    natives: HashMap<String, NativeDown>,
    /// The plugin's messages for the runtime while its stand-in loads.
    waiting: HashMap<String, Vec<String>>,
    greetings: Greetings,
    /// Messages relayed down (to plugins) and up (to the runtime).
    down: u64,
    up: u64,
}

/// Which surfaces' pages said hello, and which were introduced again for a moved stand-in.
#[derive(Default)]
struct Greetings {
    /// Surfaces whose page said hello in its current browser.
    greeted: HashSet<String>,
    /// Surfaces greeted again for a moved stand-in: the runtime's next init is not for the page.
    reintroduced: HashSet<String>,
}

impl Greetings {
    /// The surface has a new page, or none: it says hello itself.
    fn new_page(&mut self, host: &str) {
        self.greeted.remove(host);
        self.reintroduced.remove(host);
    }

    /// Its page said hello: an init answers it.
    fn hello(&mut self, host: &str) {
        self.greeted.insert(host.to_owned());
        self.reintroduced.remove(host);
    }

    /// A stand-in loaded: whether to say hello again for a page that said it before (the stand-in
    /// moved in the shell page).
    fn stand_in(&mut self, host: &str) -> bool {
        let again = self.greeted.contains(host);
        if again {
            self.reintroduced.insert(host.to_owned());
        }
        again
    }

    /// Whether a message of type `kind` for the page answers the hello said for it, and stays here.
    fn kept(&mut self, host: &str, kind: Option<&str>) -> bool {
        kind == Some("desk:init") && self.reintroduced.remove(host)
    }
}

/// The relay's tables, shared by the shell page's client and every surface's.
#[derive(Clone, Default)]
pub struct Relay(Arc<Mutex<Tables>>);

/// Where the runtime's messages for a native plugin's surface go: its process (`native_host`).
pub type NativeDown = Arc<dyn Fn(String) + Send + Sync>;

/// The SDK's hello, said again for a page whose stand-in moved.
pub const HELLO: &str = r#"{"type":"desk:hello"}"#;

/// What the shell tells a stand-in when its plugin's page tabbed past an end (#123).
const LEAVE: &str = "desk:stand-in-leave";

/// The message type a relayed text carries, when it is a JSON object with one.
fn kind(text: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    value.get("type")?.as_str().map(str::to_owned)
}

/// A stand-in's own `desk:stand-in-tab`: the Tab it wants pressed, `Some(true)` for Shift+Tab.
fn stand_in_tab(text: &str) -> Option<bool> {
    if !text.contains("desk:stand-in-tab") {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    (value.get("type")?.as_str()? == "desk:stand-in-tab")
        .then(|| value.get("back").and_then(serde_json::Value::as_bool) == Some(true))
}

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
        tables.greetings.new_page(host);
        match browser {
            Some(browser) => tables.surfaces.insert(host.to_owned(), browser),
            None => tables.surfaces.remove(host),
        };
    }

    /// The surface `host` is a native plugin's, whose page messages `down` takes (or no longer):
    /// a new process each time, which says hello itself.
    pub fn native(&self, host: &str, down: Option<NativeDown>) {
        let mut tables = self.tables();
        tables.greetings.new_page(host);
        match down {
            Some(down) => tables.natives.insert(host.to_owned(), down),
            None => tables.natives.remove(host),
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
        let (waiting, again) = {
            let mut tables = self.tables();
            tables.stand_ins.insert(host.clone(), frame.clone());
            let again = tables.greetings.stand_in(&host);
            (tables.waiting.remove(&host).unwrap_or_default(), again)
        };
        if again {
            crate::host::send(frame.clone(), HELLO.to_owned());
        }
        for text in waiting {
            crate::host::send(frame.clone(), text);
        }
    }

    /// The runtime posted `text` to the stand-in `frame`: to the surface's page. The stand-in's own
    /// Tab (`stand_in.html`, #123) is pressed in the shell page instead, whose focus it has.
    pub fn down(&self, frame: &Frame, text: String) {
        let url = CefString::from(&frame.url()).to_string();
        let Some(host) = surface_host(&url) else {
            return;
        };
        if let Some(back) = stand_in_tab(&text) {
            if let Some(page) = frame.browser().and_then(|b| b.host()) {
                super::input::press_tab(&page, back);
            }
            return;
        }
        let (target, native) = {
            let mut tables = self.tables();
            if tables.greetings.kept(&host, kind(&text).as_deref()) {
                // The answer to the hello said for it: the page is past its init.
                return;
            }
            tables.down += 1;
            let native = tables.natives.get(&host).cloned();
            (
                tables.surfaces.get(&host).and_then(|b| b.main_frame()),
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

    /// The page of surface `host` posted `text` to its parent: to the runtime, through the stand-in.
    pub fn up(&self, host: &str, text: String) {
        let target = {
            let mut tables = self.tables();
            tables.up += 1;
            if kind(&text).as_deref() == Some("desk:hello") {
                tables.greetings.hello(host);
            }
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

    /// The page of surface `host` tabbed past its last control (`next`) or before its first: its
    /// stand-in leaves the shell page's focus at that edge and has Tab pressed there (#123).
    pub fn leave(&self, host: &str, next: bool) {
        let frame = self
            .tables()
            .stand_ins
            .get(host)
            .filter(|f| f.is_valid() == 1)
            .cloned();
        if let Some(frame) = frame {
            let text = serde_json::json!({ "type": LEAVE, "next": next });
            crate::host::send(frame, text.to_string());
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
    use super::{Greetings, kind, stand_in_tab, surface_host};

    const NOTES: &str = "main.endue-notes";

    #[test]
    fn only_a_stand_ins_own_tab_is_pressed_in_the_page() {
        let tab = |text: &str| stand_in_tab(text);
        assert_eq!(
            tab(r#"{"type":"desk:stand-in-tab","back":true}"#),
            Some(true)
        );
        assert_eq!(
            tab(r#"{"type":"desk:stand-in-tab","back":false}"#),
            Some(false)
        );
        assert_eq!(tab(r#"{"type":"desk:stand-in-tab"}"#), Some(false));
        assert_eq!(
            tab(r#"{"type":"desk:state","note":"desk:stand-in-tab"}"#),
            None,
            "a runtime message for the plugin that names it"
        );
        assert_eq!(tab("desk:stand-in-tab"), None);
    }

    #[test]
    fn a_moved_stand_in_greets_the_runtime_again_and_its_init_stays_here() {
        let mut g = Greetings::default();
        assert!(
            !g.stand_in(NOTES),
            "the first stand-in: the page says hello itself"
        );
        g.hello(NOTES);
        assert!(
            !g.kept(NOTES, Some("desk:init")),
            "the init for its own hello goes to it"
        );
        // The window was split: the page moved the frame, which loaded again.
        assert!(g.stand_in(NOTES));
        assert!(!g.kept(NOTES, Some("desk:theme")));
        assert!(g.kept(NOTES, Some("desk:init")));
        assert!(!g.kept(NOTES, Some("desk:init")), "only the one init");
        // Slept and woken: a new page, which says hello itself.
        g.new_page(NOTES);
        assert!(!g.stand_in(NOTES));
        assert_eq!(
            kind(r#"{"type":"desk:hello"}"#).as_deref(),
            Some("desk:hello")
        );
        assert_eq!(kind("not json"), None);
    }

    #[test]
    fn a_page_that_says_hello_again_itself_takes_the_next_init() {
        let mut g = Greetings::default();
        g.hello(NOTES);
        assert!(g.stand_in(NOTES));
        // A new revision loaded in the same browser: its own hello comes first.
        g.hello(NOTES);
        assert!(!g.kept(NOTES, Some("desk:init")));
    }

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
