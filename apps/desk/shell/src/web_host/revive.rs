//! What the host does about a page that stopped painting (#157, `stall.rs`): it says so once, in the
//! log and in `compositor_stats` (the view's counts), and loads a plugin surface's page again in its
//! browser, as the wake of a surface whose renderer died does (`load_again`). The new page has a new
//! frame sink, so CEF's begin frames reach it again; the runtime gives it its last `desk:state` as
//! after any load. A window's own page (ADR 0201) is the runtime's DOM, which no load brings back,
//! and its view stays without frames through one: its browser closes, and its window opens a page
//! anew (`replace_window_page`). The desk's own page is only reported: loading it again would
//! restart the runtime.

use cef::*;

use super::WebHost;
use super::lifecycle::State;
use super::stall::{AGAIN, Found, Verdict};
use super::view::SharedView;

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
        let (secs, fed) = (found.waited.as_secs_f32(), found.fed);
        let said = format!(
            "endue Desk: {what} stopped painting: its page waited {secs:.1} s for a frame \
             through {fed} begin frames (#157)"
        );
        let Some(surface) = surface else {
            eprintln!("{said}; a restart of the desk brings it back");
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
