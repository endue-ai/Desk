//! Which of the desk page's reports the scene is laid out from (#269, ADR 0215). The page sends its
//! report (the size it laid itself out for, its bars' and dock's boxes, the edge surfaces' places,
//! where its windows go) and its picture apart; while the app window resizes the report runs a
//! paint or more ahead of the picture, and a scene laid out from it draws a new layout over an old
//! picture of the page: a bar or the dock where the picture has something else. So a report laid
//! out for another size than the page's last picture is held, and the picture of its size takes it,
//! as a window's frame waits for its picture (ADR 0211): every frame draws the page's picture with
//! the scene it was laid out for. A report of the picture's size is taken at once (at rest nothing
//! waits), and so is any while no picture can come (none yet, the window off screen). A picture of
//! a size no report has (the page painted before its report came) takes the newest held, so no
//! report waits for a picture that never comes; and at most `MOST_HELD` are held, a count, not a
//! time.

use std::time::Instant;

use desk_wm::{Rect, Size};
use serde_json::json;

use super::super::report::{DeskReport, Layer};
use super::{Hosted, Outcome};

/// The most reports held at once: past it the oldest goes.
const MOST_HELD: usize = 16;

/// The reports held for a picture of their size, oldest first, and the size of the page's last
/// picture (device pixels).
#[derive(Default)]
pub(super) struct Held {
    reports: Vec<DeskReport>,
    picture: Option<(u32, u32)>,
}

/// Whether `report` was laid out for a picture of `size` device pixels at `scale`, to a pixel.
pub(super) fn laid_for(report: &DeskReport, (w, h): (u32, u32), scale: f64) -> bool {
    let px = |v: f64| (v * scale).round() as i64;
    (px(report.width) - i64::from(w)).abs() <= 1 && (px(report.height) - i64::from(h)).abs() <= 1
}

impl Hosted {
    /// Take the page's `report` at `now`, unless it is older than one taken or held; one laid out
    /// for another size than the page's picture waits for a picture of its size.
    pub fn apply(&mut self, report: DeskReport, now: Instant) -> Outcome {
        let newest = (self.held.reports.last().map(|r| r.seq)).max(self.seq_taken());
        if newest.is_some_and(|seq| report.seq < seq) {
            return Outcome::default();
        }
        let waits = (self.held.picture).is_some_and(|size| !laid_for(&report, size, self.scale));
        if waits && !self.occluded {
            crate::frame_trace::line(
                "held",
                json!({ "seq": report.seq, "size": [report.width, report.height] }),
            );
            self.held.reports.push(report);
            if self.held.reports.len() > MOST_HELD {
                self.held.reports.remove(0);
            }
            return Outcome::default();
        }
        self.held.reports.clear();
        self.take(report, now)
    }

    /// The page attached a picture of `size` device pixels: the newest report held for that size
    /// is taken and the ones before it go; one of a size no report has takes the newest held.
    pub fn page_picture(&mut self, size: (u32, u32), now: Instant) -> Outcome {
        self.held.picture = Some(size);
        let scale = self.scale;
        let fits = |r: &DeskReport| laid_for(r, size, scale);
        if let Some(at) = self.held.reports.iter().rposition(fits) {
            let report = self.held.reports.drain(..=at).next_back().expect("held");
            return self.take(report, now);
        }
        if self.report.as_ref().is_none_or(fits) {
            return Outcome::default();
        }
        // The page painted a size before its report came: the scene trails its picture.
        crate::frame_trace::line("unlaid", json!({ "picture": [size.0, size.1] }));
        let Some(report) = self.held.reports.pop() else {
            return Outcome::default();
        };
        self.held.reports.clear();
        self.take(report, now)
    }

    /// Off screen the page paints nothing: the newest report held is taken.
    pub(super) fn release(&mut self, now: Instant) -> Option<Outcome> {
        let report = self.held.reports.pop()?;
        self.held.reports.clear();
        Some(self.take(report, now))
    }
    fn seq_taken(&self) -> Option<u64> {
        self.report.as_ref().map(|r| r.seq)
    }

    /// Lay the scene out from `report` at `now`; what follows.
    fn take(&mut self, report: DeskReport, now: Instant) -> Outcome {
        self.docs = report.frames.iter().filter_map(super::doc).collect();
        let screen = Size {
            w: report.width,
            h: report.height,
        };
        // What lies above every window, as the page lays it out: a drop keeps a title bar clear
        // of the edge bars (the dock), and no window's grip or title bar lies over the system
        // layer's parts and surfaces (an overlay is its own, ADR 0190).
        let edges = (report.frames.iter())
            .filter_map(|f| f.place.filter(|p| p.shown && p.layer == Layer::Edge))
            .map(|p| Rect::new(p.x, p.y, p.width, p.height));
        self.wm.set_edge_bars(edges.collect());
        self.wm
            .set_system_parts(super::super::system::over_windows(&report));
        let wm = self.wm.took(report.applied, screen);
        self.report = Some(report);
        let mut outcome = self.replan(now);
        outcome.wm = wm;
        outcome
    }
}
