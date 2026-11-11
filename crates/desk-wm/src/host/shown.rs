//! What the page's picture shows of each window. The page reports where it lays a window out as
//! soon as its DOM has it there, a frame or two before its texture does: a compositor that took the
//! report's place at once would cut a window's parts from where the picture does not have them yet
//! (another window's pixels, the desk under it) and draw the place the picture still has them above
//! every window (the trail a fast drag leaves). So a layout the page reports waits here until its
//! paints show it: the damage of the paints since it was reported covers every pixel the change
//! moves in the picture (what the window's parts covered before and cover now, not both), or the
//! page quiet for `QUIET_MS` after it (a page that paints nothing for it). A report reaches the
//! desk on a thread of its own and often after the paint that shows it, so a paint up to
//! `REORDER_MS` older than its report counts. A window the page no longer lays out stays in the
//! picture until paints clear its parts too.

use std::collections::{BTreeMap, VecDeque};

use super::cut::{intersect, subtract};
use crate::types::Rect;

/// How long the page paints nothing before its last layout counts as painted, in milliseconds.
pub const QUIET_MS: f64 = 150.0;

/// How much earlier than its report a paint that shows it may come, in milliseconds.
pub const REORDER_MS: f64 = 40.0;

/// Pixels a damage may miss at each edge of a change: fractions of a pixel in the layout, a border
/// drawn half in.
const SLACK: f64 = 1.0;

/// The most paints kept for reports still to come.
const PAINTS: usize = 128;

/// Where the page lays a window out, and the parts it draws of it there (`HostWindow::page_parts`'
/// sources), in CSS pixels.
#[derive(Clone, Debug, PartialEq)]
pub struct Laid {
    pub rect: Rect,
    pub parts: Vec<Rect>,
}

/// A layout the page reported at `at` (ms), not painted yet.
#[derive(Clone, Debug, PartialEq)]
struct Waiting {
    laid: Laid,
    at: f64,
}

/// A window the picture shows, and the last paint that counted for it.
#[derive(Clone, Debug, PartialEq)]
struct Shown {
    laid: Laid,
    since: u64,
}

/// A part of a window the page dropped at `at`, which the picture may still show; the paints after
/// paint `since` may have cleared it.
#[derive(Clone, Debug, PartialEq)]
struct Gone {
    part: Rect,
    at: f64,
    since: u64,
}

/// One paint of the page: its number, when it came and its damage.
#[derive(Clone, Debug, PartialEq)]
struct Paint {
    seq: u64,
    at: f64,
    damage: Vec<Rect>,
}

/// The page's picture of the windows, as its paints show them.
#[derive(Clone, Debug, Default)]
pub struct PageShown {
    screen: Option<Rect>,
    shown: BTreeMap<String, Shown>,
    waiting: BTreeMap<String, Vec<Waiting>>,
    gone: Vec<Gone>,
    paints: VecDeque<Paint>,
    seq: u64,
}

/// The pixels that differ between `a` and `b`: in one and not the other.
fn change(a: &[Rect], b: &[Rect]) -> Vec<Rect> {
    let mut out: Vec<Rect> = a.iter().flat_map(|r| subtract(*r, b)).collect();
    out.extend(b.iter().flat_map(|r| subtract(*r, a)));
    out
}

/// Whether `damage` covers each of `rects` on `screen`, but for `SLACK` at its edges.
fn covered(rects: &[Rect], damage: &[Rect], screen: Option<Rect>) -> bool {
    rects.iter().all(|r| {
        let Some(on) = screen.map_or(Some(*r), |s| intersect(*r, s)) else {
            return true;
        };
        let (w, h) = (on.w - 2.0 * SLACK, on.h - 2.0 * SLACK);
        if w <= 0.0 || h <= 0.0 {
            return true;
        }
        subtract(Rect::new(on.x + SLACK, on.y + SLACK, w, h), damage).is_empty()
    })
}

impl PageShown {
    pub fn new() -> PageShown {
        PageShown::default()
    }

    /// The page lays `windows` out now (its report taken at `now` ms) on a page of `screen`.
    /// A window whose parts move nowhere is shown there at once; one the page has no longer leaves
    /// its parts in the picture until paints clear them.
    pub fn laid(&mut self, windows: &BTreeMap<String, Laid>, screen: Rect, now: f64) {
        self.screen = Some(screen);
        let known: Vec<String> = (self.shown.keys().chain(self.waiting.keys()))
            .filter(|id| !windows.contains_key(*id))
            .cloned()
            .collect();
        for id in known {
            self.waiting.remove(&id);
            if let Some(was) = self.shown.remove(&id) {
                let (at, since) = (now, was.since);
                let parts = was.laid.parts.into_iter();
                self.gone.extend(parts.map(|part| Gone { part, at, since }));
            }
        }
        for (id, laid) in windows {
            let queue = self.waiting.entry(id.clone()).or_default();
            let last = (queue.last().map(|w| &w.laid)).or(self.shown.get(id).map(|s| &s.laid));
            if last == Some(laid) {
                continue;
            }
            // Nothing the page draws of it moves: the picture has it there already.
            let still = (self.shown.get(id))
                .is_some_and(|was| change(&was.laid.parts, &laid.parts).is_empty());
            if still {
                queue.clear();
                let since = self.seq;
                let shown = Shown {
                    laid: laid.clone(),
                    since,
                };
                self.shown.insert(id.clone(), shown);
            } else {
                queue.push(Waiting {
                    laid: laid.clone(),
                    at: now,
                });
            }
        }
        self.waiting.retain(|_, q| !q.is_empty());
        self.resolve();
    }

    /// The page painted at `now` ms, its damage `damage` (CSS pixels): each window takes the newest
    /// layout its paints show. Whether what is shown changed.
    pub fn painted(&mut self, damage: &[Rect], now: f64) -> bool {
        self.seq += 1;
        self.paints.push_back(Paint {
            seq: self.seq,
            at: now,
            damage: damage.to_vec(),
        });
        let changed = self.resolve();
        // What a report still to come, or one waiting, may need.
        let oldest = (self.waiting.values().flatten().map(|w| w.at))
            .chain(self.gone.iter().map(|g| g.at))
            .fold(now, f64::min);
        let keep = oldest - REORDER_MS;
        while self.paints.len() > PAINTS || self.paints.front().is_some_and(|p| p.at < keep) {
            self.paints.pop_front();
        }
        changed
    }

    /// Take, for each window waiting, the newest layout its paints show, and clear the gone parts
    /// they cleared. Whether anything changed.
    fn resolve(&mut self) -> bool {
        let mut changed = false;
        let screen = self.screen;
        for (id, queue) in self.waiting.iter_mut() {
            let mut base = self.shown.get(id).cloned();
            while let Some(first) = queue.first() {
                let from = first.at - REORDER_MS;
                let since = base.as_ref().map_or(0, |b| b.since);
                let was: Vec<Rect> = base.as_ref().map_or(Vec::new(), |b| b.laid.parts.clone());
                let mut acc: Vec<Rect> = Vec::new();
                let mut taken = None;
                for p in self.paints.iter().filter(|p| p.seq > since && p.at >= from) {
                    acc.extend(p.damage.iter().copied());
                    let shows = |w: &Waiting| {
                        p.at >= w.at - REORDER_MS
                            && covered(&change(&was, &w.laid.parts), &acc, screen)
                    };
                    if let Some(i) = queue.iter().rposition(shows) {
                        taken = Some((i, p.seq));
                        break;
                    }
                }
                let Some((i, seq)) = taken else { break };
                let laid = queue.drain(..=i).next_back().map(|w| w.laid);
                base = laid.map(|laid| Shown { laid, since: seq });
                changed = true;
            }
            if let Some(base) = base {
                self.shown.insert(id.clone(), base);
            }
        }
        self.waiting.retain(|_, q| !q.is_empty());
        let paints = &self.paints;
        let before = self.gone.len();
        self.gone.retain(|g| {
            let acc: Vec<Rect> = (paints.iter())
                .filter(|p| p.seq > g.since && p.at >= g.at - REORDER_MS)
                .flat_map(|p| p.damage.iter().copied())
                .collect();
            !covered(std::slice::from_ref(&g.part), &acc, screen)
        });
        changed || self.gone.len() != before
    }

    /// When the page has been quiet long enough at `now` ms, every layout it reported counts as
    /// painted and every gone window's parts as cleared. Whether what is shown changed.
    pub fn settle(&mut self, now: f64) -> bool {
        match self.due() {
            Some(due) if now >= due => {}
            _ => return false,
        }
        let since = self.seq;
        for (id, queue) in std::mem::take(&mut self.waiting) {
            if let Some(last) = queue.into_iter().next_back() {
                let laid = last.laid;
                self.shown.insert(id, Shown { laid, since });
            }
        }
        self.gone.clear();
        true
    }

    /// When `settle` takes the layouts waiting, if any wait.
    pub fn due(&self) -> Option<f64> {
        let oldest = (self.waiting.values().flatten().map(|w| w.at))
            .chain(self.gone.iter().map(|g| g.at))
            .reduce(f64::min)?;
        let last = self.paints.back().map_or(oldest, |p| p.at.max(oldest));
        Some(last + QUIET_MS)
    }

    /// Where the picture shows window `id`, if it shows it.
    pub fn rect(&self, id: &str) -> Option<Rect> {
        self.shown.get(id).map(|s| s.laid.rect)
    }

    /// The parts of windows gone from the page that the picture may still show.
    pub fn stale(&self) -> Vec<Rect> {
        self.gone.iter().map(|g| g.part).collect()
    }

    /// Whether a layout waits for a paint.
    pub fn waiting(&self) -> bool {
        !self.waiting.is_empty() || !self.gone.is_empty()
    }
}

#[cfg(test)]
#[path = "shown_tests.rs"]
mod tests;
