//! A web surface's accessibility (#57, `specs/surface/v0/accessibility.md`): the protocol's
//! `a11y.*` on CEF. `a11y.enable` turns the browser's accessibility on (`SetAccessibilityState`), so
//! Chromium serializes its tree only while an assistive technology is active; every
//! `OnAccessibilityTreeChange` and `OnAccessibilityLocationChange` (Chromium's tree updates and new
//! boxes, as a `CefValue` written as JSON) goes into the surface's mirror of Chromium's trees
//! (`a11y_tree.rs`), which answers the `a11y.update` with what changed; after a location change the
//! scrolled containers' offsets are read again (`a11y_devtools.rs`); `a11y.action` is done as a
//! person's input would (`a11y_actions.rs`). The state lives with the surface's view, so it outlives
//! one browser: a woken surface's new browser exports again at once.

use std::sync::{Arc, Mutex, MutexGuard};

use cef::*;
use desk_surface::generated::{CompositorMessage, SurfaceA11yAction, SurfaceMessage};
use serde_json::Value;

#[path = "a11y_actions.rs"]
pub mod actions;
#[path = "a11y_devtools.rs"]
pub mod devtools;
#[path = "a11y_nodes.rs"]
pub mod nodes;
#[path = "a11y_tree.rs"]
pub mod tree;

use super::SharedView;
use crate::web_host::{SurfaceSink, WebHost};
use devtools::{DevTools, observer, send};
use tree::WebTree;

/// One surface's accessibility. Cheap to clone; every clone is the same.
#[derive(Clone, Default)]
pub struct Exports(Arc<Mutex<Export>>);

/// Whether the surface exports, its mirror of Chromium's trees, its DevTools state and the
/// browser that exports.
#[derive(Default)]
pub struct Export {
    pub enabled: bool,
    pub tree: WebTree,
    pub devtools: DevTools,
    pub browser: Option<Browser>,
}

impl std::fmt::Debug for Exports {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let enabled = self.lock().enabled;
        f.debug_struct("Exports")
            .field("enabled", &enabled)
            .finish()
    }
}

impl Exports {
    pub fn lock(&self) -> MutexGuard<'_, Export> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Chromium's message as JSON (`CefWriteJSON`), when it is one; `DESK_A11Y_DUMP=1` prints it.
fn json_of(value: Option<&mut cef::Value>) -> Option<Value> {
    let text = cef::write_json(value, JsonWriterOptions::default());
    let text = CefString::from(&text).to_string();
    if std::env::var_os("DESK_A11Y_DUMP").is_some() {
        eprintln!("A11Y-DUMP {text}");
    }
    serde_json::from_str(&text).ok()
}

wrap_accessibility_handler! {
    pub struct SurfaceA11y {
        surface: String,
        view: SharedView,
        exports: Exports,
        sink: Arc<dyn SurfaceSink>,
    }

    impl AccessibilityHandler {
        fn on_accessibility_tree_change(&self, value: Option<&mut cef::Value>) {
            let Some(json) = json_of(value) else { return };
            self.said(|tree| tree.events(&json), false);
        }

        fn on_accessibility_location_change(&self, value: Option<&mut cef::Value>) {
            let Some(json) = json_of(value) else { return };
            self.said(|tree| tree.locations(&json), true);
        }
    }
}

impl SurfaceA11y {
    /// Chromium said something: fold it in, tell the compositor what changed, and after a move read
    /// where the scrolled containers are.
    fn said(&self, fold: impl FnOnce(&mut WebTree), moved: bool) {
        let scale = f64::from(self.view.lock().scale);
        let (update, read) = {
            let mut export = self.exports.lock();
            if !export.enabled {
                return;
            }
            fold(&mut export.tree);
            let update = export.tree.update(&self.surface, scale);
            let scrollers = if moved {
                export.tree.scrollers()
            } else {
                Vec::new()
            };
            let commands = if scrollers.is_empty() {
                Vec::new()
            } else {
                export.devtools.read_scrolls(scrollers)
            };
            let messages = export.devtools.queue(commands);
            (
                update,
                export
                    .browser
                    .as_ref()
                    .and_then(|b| b.host())
                    .map(|h| (h, messages)),
            )
        };
        if let Some(update) = update {
            self.sink.message(SurfaceMessage::SurfaceA11yUpdate(update));
        }
        if let Some((host, messages)) = read {
            send(&host, messages);
        }
    }
}

/// The accessibility handler a surface's render handler hands CEF.
pub fn handler(view: &SharedView, sink: &Arc<dyn SurfaceSink>) -> AccessibilityHandler {
    let (surface, exports) = {
        let view = view.lock();
        (view.surface.clone(), view.a11y.clone())
    };
    SurfaceA11y::new(surface, view.clone(), exports, Arc::clone(sink))
}

impl WebHost {
    /// An `a11y.enable` or `a11y.action` for a surface or the page; false when it is neither.
    pub fn a11y(&self, surface: &str, message: &CompositorMessage) -> bool {
        let (enabled, action) = match message {
            CompositorMessage::SurfaceA11yEnable(e) => (Some(e.enabled), None),
            CompositorMessage::SurfaceA11yAction(a) => (None, Some(a)),
            _ => return false,
        };
        let Some((browser, view)) = self.browser_and_view(surface) else {
            return true;
        };
        if let Some(enabled) = enabled {
            self.set_a11y(browser.as_ref(), &view, enabled);
        }
        if let (Some(action), Some(browser)) = (action, browser) {
            self.act_a11y(&browser, &view, action);
        }
        true
    }

    /// Whether surface `surface` (or the page) exports its tree; `None` for one the host does not
    /// have.
    pub fn a11y_exports(&self, surface: &str) -> Option<bool> {
        let (_, view) = self.browser_and_view(surface)?;
        let exports = view.lock().a11y.clone();
        let enabled = exports.lock().enabled;
        Some(enabled)
    }

    /// A new browser for surface `surface` (it woke, it loaded again, CEF's `OnAfterCreated`): it
    /// exports too if the surface does.
    pub fn a11y_created(&self, surface: &str, browser: &Browser) {
        let Some((_, view)) = self.browser_and_view(surface) else {
            return;
        };
        let enabled = view.lock().a11y.lock().enabled;
        if enabled {
            self.set_a11y(Some(browser), &view, true);
        }
    }

    /// Turn the accessibility of `browser` (of the surface `view` is) on or off; each export starts
    /// from a whole tree.
    fn set_a11y(&self, browser: Option<&Browser>, view: &SharedView, enabled: bool) {
        let (surface, exports) = {
            let view = view.lock();
            (view.surface.clone(), view.a11y.clone())
        };
        {
            let mut export = exports.lock();
            export.enabled = enabled;
            export.tree = WebTree::default();
            export.browser = browser.filter(|_| enabled).cloned();
            if !enabled {
                export.devtools = DevTools::default();
            }
        }
        let Some((browser, host)) = browser.and_then(|b| Some((b, b.host()?))) else {
            return;
        };
        let watching = exports.lock().devtools.watches(browser.identifier());
        if enabled && !watching {
            let mut watch = observer(&exports.0, &self.sink, &surface, view);
            let registration = host.add_dev_tools_message_observer(Some(&mut watch));
            let mut export = exports.lock();
            export.devtools = DevTools::default();
            export
                .devtools
                .set_watch(browser.identifier(), registration);
        }
        host.set_accessibility_state(if enabled {
            cef::State::ENABLED
        } else {
            cef::State::DISABLED
        });
    }

    /// The browser and view of a surface, or of the compositor's page.
    fn browser_and_view(&self, surface: &str) -> Option<(Option<Browser>, SharedView)> {
        let inner = self.inner();
        if let Some(r) = inner.records.get(surface) {
            return Some((r.browser.clone(), r.view.clone()));
        }
        let page = inner.page.as_ref()?;
        let named = page.view.lock().surface == surface;
        named.then(|| (Some(page.browser.clone()), page.view.clone()))
    }

    fn act_a11y(&self, browser: &Browser, view: &SharedView, action: &SurfaceA11yAction) {
        let exports = view.lock().a11y.clone();
        let (messages, presses) = {
            let mut export = exports.lock();
            if !export.enabled {
                return;
            }
            let (commands, presses) = actions::start(&export.tree, action);
            (export.devtools.queue(commands), presses)
        };
        let Some(host) = browser.host() else { return };
        send(&host, messages);
        for press in presses {
            crate::web_host::input::deliver(&host, &press, &mut None, 0.0);
        }
    }
}
