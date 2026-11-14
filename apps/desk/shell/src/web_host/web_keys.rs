//! Who has the keys in a window with a web view (#273, ADR 0216). The desk gives the keys to a
//! plugin's surface (the window in use, the place the page focused); the view stands in for it
//! while it has them: a press in the view or `web.focus` gives them, a press on the plugin's own
//! surface takes them back. The compositor window asks `web_stand_in` wherever it names the
//! surface the keys go to (`compositor_window/input.rs`).

use desk_core::WebError;

use super::WebHost;
use super::lifecycle::State;
use super::web_rules::{host_of, surface_of};
use super::web_views::{missing, shows};

impl WebHost {
    /// View `view` has the keys from now on, as after a press in it.
    pub fn web_focus(&self, view: &str) -> Result<(), WebError> {
        let mut inner = self.inner();
        let host = inner.web.host_of(view).ok_or_else(|| missing(view))?;
        if let Some(web) = inner.web.by_host.get_mut(&host) {
            web.keys = true;
        }
        Ok(())
    }

    /// A press went to `surface`: on a view it gives the view the keys, on a window's own
    /// surface it takes them back from that window's view.
    pub fn web_pressed(&self, surface: &str) {
        let mut inner = self.inner();
        let (host, keys) = match host_of(surface) {
            Some(host) => (host, true),
            None => (surface, false),
        };
        if let Some(web) = inner.web.by_host.get_mut(host) {
            web.keys = keys;
        }
    }

    /// The surface the keys go to when the desk gives them to the surface with host `host`: its
    /// view, while that has them and shows; else the surface itself.
    pub fn web_stand_in(&self, host: &str) -> String {
        let inner = self.inner();
        let surface = surface_of(host);
        let has = (inner.web.by_host.get(host)).is_some_and(|v| v.keys && shows(&v.place));
        let live = (inner.records.get(&surface))
            .is_some_and(|r| r.browser.is_some() && r.state == State::Live { hidden: false });
        if has && live {
            surface
        } else {
            host.to_owned()
        }
    }
}
