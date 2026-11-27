//! What the host does about a page that stopped painting (#157, `stall.rs`): it says so once, in the
//! log and in `compositor_stats` (the view's counts), and loads a plugin surface's page again in its
//! browser, as the wake of a surface whose renderer died does (`load_again`). The new page has a new
//! frame sink, so CEF's begin frames reach it again; the runtime gives it its last `desk:state` as
//! after any load. The runtime did not load it, so it is told (`RELOADED`, #378): what the page
//! before it started ends there, its plugin's captures (ADR 0245), as on the runtime's own reload.
//! A window's own page (ADR 0201) is the runtime's DOM, which no load brings back, and its view
//! stays without frames through one: its browser closes, and its window opens a page anew
//! (`replace_window_page`). The desk's own page is not loaded again, as that would restart the
//! runtime under every plugin's page: the desk quits as the person's quit does and starts a new
//! desk, unless the page says something is unsaved (ADR 0202, `quit.rs`, `stall_restart.rs`).

use cef::*;
use desk_web::plugin_scheme::hosts::Host;
use desk_web::sender::Role;
use serde_json::{Value, json};

use super::WebHost;
use super::lifecycle::State;
use super::stall::{AGAIN, Found, Verdict};
use super::view::SharedView;

/// What the desk's page hears, with `{ plugin }`, when the host loaded a plugin surface's page again
/// by itself (`apps/desk/src/frame-signals.ts`), as it hears a renderer's death (`crashes.rs`).
pub const RELOADED: &str = "desk://frame-reloaded";

/// What the desk's page is told when the host loads `surface`'s page again by itself: only a
/// plugin's surface, named by its host as `desk://frame-crashed` names it.
fn reloaded(surface: &str) -> Option<Value> {
    match Host::parse(Some(surface))? {
        Host::Surface { plugin, .. } => Some(json!({ "plugin": plugin })),
        Host::Shared => None,
    }
}

impl WebHost {
    /// Load `surface`'s document again in `browser`: the document as it is now (a new revision may
    /// have come meanwhile), or the page it shows.
    pub(super) fn load_again(&self, surface: &str, view: &SharedView, browser: Option<&Browser>) {
        view.lock().restart();
        let url = self.inner().sources.get(surface).cloned();
        match (browser.and_then(|b| b.main_frame()), url) {
            (Some(frame), Some(url)) => frame.load_url(Some(&url.as_str().into())),
            _ => {
                if let Some(browser) = browser {
                    browser.reload();
                }
            }
        }
    }

    /// The watch found the page of `surface` stalled (`None`: the desk's own page).
    pub(super) fn stalled(&self, surface: Option<&str>, found: Found) {
        let what = surface.map_or_else(|| "the desk's page".to_owned(), |s| format!("surface {s}"));
        crate::frame_trace::line(
            "stall",
            serde_json::json!({ "surface": surface.unwrap_or("desk") }),
        );
        let (secs, fed) = (found.waited.as_secs_f32(), found.fed);
        let said = format!(
            "endue: {what} stopped painting: its page waited {secs:.1} s for a frame \
             through {fed} begin frames (#157)"
        );
        let Some(surface) = surface else {
            eprintln!("{said}; the desk quits to start again unless something is unsaved");
            if let Some(desk) = &self.desk {
                desk.pump.run(crate::quit::stalled);
            }
            return;
        };
        let live = self.inner().records.get(surface).and_then(|r| {
            let shown = r.state == State::Live { hidden: false };
            shown.then(|| (r.view.clone(), r.browser.clone()))
        });
        match (found.verdict, live) {
            // A window's page is the runtime's to build (ADR 0201): loaded again it would be blank.
            (Verdict::Reload, Some((view, _))) if super::window_pages::is_window_page(surface) => {
                view.lock().counts.stall_reloads += 1;
                self.replace_window_page(surface, &format!("stopped painting: its page waited {secs:.1} s for a frame through {fed} begin frames (#157)"));
            }
            (Verdict::Reload, Some((view, browser))) => {
                eprintln!("{said}; loading it again");
                view.lock().counts.stall_reloads += 1;
                // Told before the load, so the old page's captures end before the new page starts.
                if let (Some(desk), Some(payload)) = (&self.desk, reloaded(surface)) {
                    desk.pages.emit(Role::Main, RELOADED, payload);
                }
                self.load_again(surface, &view, browser.as_ref());
            }
            (Verdict::Reload, None) => eprintln!("{said}; it is no longer shown"),
            (Verdict::Report, _) => eprintln!(
                "{said}; it was loaded again less than {} s ago, so it waits",
                AGAIN.as_secs()
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::reloaded;
    use serde_json::json;

    #[test]
    fn a_plugin_surface_loaded_again_names_its_plugin_to_the_desks_page() {
        assert_eq!(
            reloaded("main.example-notes"),
            Some(json!({ "plugin": "example.notes" }))
        );
        assert_eq!(
            reloaded("main--2.endue-images.localhost"),
            Some(json!({ "plugin": "endue.images" })),
            "a second window, in Windows' form"
        );
        assert_eq!(
            reloaded("localhost"),
            None,
            "the shared host is no plugin's"
        );
        assert_eq!(
            reloaded("window:w-1"),
            None,
            "a window's own page is the runtime's"
        );
    }
}
