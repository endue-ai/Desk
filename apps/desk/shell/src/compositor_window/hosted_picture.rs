//! What the page's picture shows of the hosted windows (`desk_wm::PageShown`): the page's DOM lays a
//! window out a frame or two before its texture shows it there, so each plan takes a window's
//! parts from where the picture shows it, sends the pointer on them to where the DOM has it, draws
//! none of a window the picture does not show yet, and never draws above the windows what the
//! picture still shows of one gone. The page's paints, with their damage, move the picture on.

use std::collections::BTreeMap;
use std::time::Instant;

use desk_wm::{Desk, Laid, PageShown, Places, Rect};

use super::super::report::DeskReport;
use super::{Hosted, Outcome};

/// The places to plan from: each window drawn at `drawn` (where the window manager has it ahead of
/// the page), its parts taken from where `painted` says the picture shows it, the pointer on them
/// sent to where the DOM lays it out (`laid`), which waits in `painted` for its paint.
pub(super) fn places(
    painted: &mut PageShown,
    desk: &Desk,
    report: &DeskReport,
    drawn: BTreeMap<String, Rect>,
    laid: BTreeMap<String, Rect>,
    now_ms: f64,
) -> Places {
    let (vw, vh) = (report.width, report.height);
    let dom = Places {
        drawn: drawn.clone(),
        page: laid.clone(),
        ..Places::default()
    };
    // What the page draws of each window where its DOM has it.
    let first = desk.host_plan_at(vw, vh, report.top, report, &dom);
    let layout: BTreeMap<String, Laid> = (first.windows.iter())
        .filter(|w| laid.contains_key(&w.id))
        .map(|w| {
            let parts = w.page_parts.iter().map(|(src, _)| *src).collect();
            (
                w.id.clone(),
                Laid {
                    rect: w.page,
                    parts,
                },
            )
        })
        .collect();
    painted.laid(&layout, Rect::new(0.0, 0.0, vw, vh), now_ms);
    let mut places = Places {
        drawn,
        heard: laid,
        stale: painted.stale(),
        ..Places::default()
    };
    for w in &first.windows {
        match painted.rect(&w.id) {
            Some(shown) => {
                places.page.insert(w.id.clone(), shown);
            }
            None => {
                places.unpainted.insert(w.id.clone());
            }
        }
    }
    places
}

impl Hosted {
    /// The page painted, `damage` its damage in CSS pixels: a window it shows where its DOM has it
    /// now is drawn from there.
    pub fn page_painted(&mut self, damage: &[Rect], now: Instant) -> Outcome {
        if self.painted.painted(damage, self.real_ms(now)) {
            self.restaged = true;
            return self.replan(now);
        }
        Outcome::default()
    }

    /// Whether what the page's picture shows changed since the last ask: the scene is drawn again.
    pub fn take_restaged(&mut self) -> bool {
        std::mem::take(&mut self.restaged)
    }

    /// The page has been quiet long enough at `now` to have painted what it laid out.
    pub(super) fn settle_picture(&mut self, now: Instant) -> bool {
        let settled = self.painted.settle(self.real_ms(now));
        self.restaged |= settled;
        settled
    }

    /// When the picture counts as painted though no paint showed it.
    pub(super) fn picture_due(&self) -> Option<f64> {
        self.painted.due()
    }
}
