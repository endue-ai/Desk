//! One owner of focus (#251, ADR 0230): `desk-wm` decides which window and pane are in use, on a
//! press before the press is routed (`wm.rs`) and when it applies the runtime's edits and the
//! window commands, and the router is told in the same turn, before anything else hears of it.
//! Nothing here waits for the page: the page is told by the desk the window manager publishes,
//! and says back only what its own fields hold (`input.rs`, `page_focus`). A window or a pane
//! that changed is a decision (`InputRouter::decided`); the surface that shows the same pane
//! changing (its page woke, its window's own page opened) only moves the keys that follow it.

use desk_compositor::input::Out;
use serde_json::{Value, json};

use desk_wm::Point;

use super::super::CompositorWindow;
use crate::web_host::window_pages;

/// What the router was last told of the window manager's focus.
#[derive(Debug, Default)]
pub struct Told {
    /// The window and the pane in use then.
    in_use: (Option<String>, Option<String>),
    /// What the router called for since that needs the event loop, for the next `apply`.
    outs: Vec<Out>,
}

impl CompositorWindow {
    /// Tell the router what the window manager has in use now, and do what that calls for at once
    /// (the surfaces hear the focus move in the same turn); only a cursor, which needs the event
    /// loop, waits in `focus_outs` for the next `apply`.
    pub(in super::super) fn tell_focus(&mut self) {
        let (window, pane) = self.hosted.wm.in_use();
        let now = (window.map(str::to_owned), pane.map(str::to_owned));
        let surface = self.surface_in_use();
        let told = &mut self.gestures.focus;
        let outs = if now == told.in_use {
            self.router.in_use(surface.as_deref())
        } else {
            told.in_use = now;
            self.router.decided(surface.as_deref())
        };
        for out in outs {
            if let Some(later) = self.apply_now(out) {
                self.gestures.focus.outs.push(later);
            }
        }
    }

    /// What telling the router called for that still waits for the event loop.
    pub(in super::super) fn focus_outs(&mut self) -> Vec<Out> {
        std::mem::take(&mut self.gestures.focus.outs)
    }

    /// The press at `at` is a window's, which the window manager just decided the keys for:
    /// nothing typed after it waits for the page.
    pub(in super::super) fn window_pressed(&mut self, at: Point) {
        if self.hosted.wm.window_at(at).is_some() {
            self.router.window_pressed();
        }
    }

    /// Before a press: the window manager knows what of the system layer lies over the windows,
    /// as the compositor draws it now.
    pub(in super::super) fn wm_sees_chrome(&mut self) {
        let chrome = (self.hosted.report()).map(|r| (r.top, super::super::system::over_windows(r)));
        if let Some((top, parts)) = chrome {
            self.hosted.wm.set_top_chrome(top);
            self.hosted.wm.set_system_parts(parts);
        }
    }

    /// The surface the window manager has in use: the one the pane in use of the window in use
    /// shows, while it is made and awake; for a pane the page draws, its window's own page while it
    /// has one (ADR 0201), else none.
    pub(in super::super) fn surface_in_use(&self) -> Option<String> {
        let plan = self.hosted.plan()?;
        let Some(plugin) = plan.focused_plugin.as_deref() else {
            let window = plan.windows.iter().find(|w| w.focused)?;
            let own = window_pages::surface_of(&window.id);
            return self.host.browser(&own).map(|_| own);
        };
        let made = self.hosted.surfaces().made();
        let (host, _, _) = made
            .into_iter()
            .find(|(_, of, asleep)| of == plugin && !asleep)?;
        // Its web view, while that has the keys (ADR 0216).
        Some(self.host.web_stand_in(&host))
    }

    /// The owner's word and what follows it, for checks (development builds): the window and pane
    /// the window manager has in use, the plugin that pane shows, and the surface that shows it.
    pub(in super::super) fn focus_state(&self) -> Value {
        let (window, pane) = self.hosted.wm.in_use();
        json!({ "window": window, "pane": pane,
            "plugin": self.hosted.wm.desk().focused_plugin(),
            "surface": self.surface_in_use() })
    }
}
