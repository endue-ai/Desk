//! What the host does about a page that stopped painting (#157, `stall.rs`): it says so once, in the
//! log and in `compositor_stats` (the view's counts), and loads a plugin surface's page again in its
//! browser, as the wake of a surface whose renderer died does (`load_again`). The new page has a new
//! frame sink, so CEF's begin frames reach it again; the runtime gives it its last `desk:state` as
//! after any load. The desk's own page is not loaded again, as that would restart the runtime under
//! every plugin's page: the desk quits as the person's quit does and starts a new desk, unless the
//! page says something is unsaved (ADR 0202, `quit.rs`, `stall_restart.rs`).

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
