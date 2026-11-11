//! The web host's side of the desk's frame clock (#111, #117, `frames.rs`): each look sends a begin
//! frame (`SendExternalBeginFrame`) to every browser the clock takes at that moment: the surfaces on
//! it, and the compositor's own shell page while it is shown, which the host does not make but
//! paints on the same clock. What the browsers heard since the last look starts their prompt frames,
//! wakes them, or, for a page that asked (`frame_asks.js`), gives a resting surface the next desk
//! frames; the next look is the soonest any of them wants, none while every one rests (#134). Each
//! view's watch counts the begin frames sent and its page's asks, and finds a page that stopped
//! painting (#157, `stall.rs`), which the host reports and loads again (`revive.rs`).

use std::time::{Duration, Instant};

use cef::*;

use super::frames::{self, Heard, Pacing};
use super::stall::Found;
use super::view::SharedView;
use super::{Inner, WebHost, copy_wake};

/// The compositor's shell page on the clock.
pub struct Page {
    pub(super) browser: Browser,
    pub(super) view: SharedView,
    pacing: Pacing,
    shown: bool,
}

/// A browser on the clock now: its surface (`None`: the shell page), its pacing and its view (which
/// counts paints and begin frames, and watches for a stall).
struct OnClock<'a> {
    surface: Option<&'a str>,
    browser: &'a Browser,
    pacing: &'a mut Pacing,
    view: &'a SharedView,
}

impl WebHost {
    /// The compositor's shell page, made outside the host, paints on its clock (`None`: no page);
    /// `view` counts its paints.
    pub fn clock_page(&self, browser: Option<Browser>, view: SharedView) {
        self.inner().page = browser.map(|browser| Page {
            browser,
            view,
            pacing: Pacing::default(),
            shown: true,
        });
    }

    /// `surface`'s page started loading (a first load, a restart, a reload in place): it keeps its
    /// desk frames until the new page paints, however long its start-up holds its thread.
    pub fn loading(&self, surface: &str) {
        if let Some(record) = self.inner().records.get_mut(surface) {
            record.pacing.loading(Instant::now());
        }
    }

    /// The shell page is shown (its window on screen) or hidden.
    pub fn page_shown(&self, shown: bool) {
        if let Some(page) = self.inner().page.as_mut() {
            if shown && !page.shown {
                page.pacing.heard(Instant::now());
            }
            page.shown = shown;
        }
    }

    /// A look of the clock at `now`: a begin frame to each browser due. When it wants its next look
    /// (`None`: nothing is on the clock, so it sleeps until a surface is shown or woken).
    pub fn begin_frames(&self, now: Instant) -> Option<Instant> {
        let heard = frames::take_heard();
        let (hosts, next, stalls) = {
            let mut inner = self.inner();
            let Inner {
                records,
                clock,
                page,
                ..
            } = &mut *inner;
            let mut on: Vec<OnClock<'_>> = records
                .iter_mut()
                .filter(|(_, r)| frames::on_clock(r.state))
                .filter_map(|(surface, r)| {
                    Some(OnClock {
                        surface: Some(surface.as_str()),
                        browser: r.browser.as_ref()?,
                        pacing: &mut r.pacing,
                        view: &r.view,
                    })
                })
                .chain(page.iter_mut().filter(|p| p.shown).map(|p| OnClock {
                    surface: None,
                    browser: &p.browser,
                    pacing: &mut p.pacing,
                    view: &p.view,
                }))
                .collect();
            let mut stalls = Vec::new();
            for (id, at, what) in heard {
                if let Some(it) = on.iter_mut().find(|it| it.browser.identifier() == id) {
                    match what {
                        Heard::Prompt => {
                            let painted = painted(it.view);
                            it.pacing.press(at, painted);
                        }
                        Heard::Woken => it.pacing.heard(at),
                        // From the look on: an ask that waited (the clock held, a hidden surface) still counts.
                        Heard::Asked(waited) => {
                            it.pacing.ask(now);
                            let found = waited.and_then(|waited| watch(it, at, waited));
                            stalls.extend(found.map(|f| (it.surface.map(str::to_owned), f)));
                        }
                    }
                }
            }
            let frame = if on.is_empty() {
                clock.stop();
                None
            } else {
                clock.frame(now)
            };
            let mut hosts = Vec::new();
            for it in &mut on {
                if !it.pacing.due(now, frame, painted(it.view)) {
                    continue;
                }
                let mut view = it.view.lock();
                view.counts.begin_frames += 1;
                view.watch.fed();
                drop(view);
                hosts.extend(it.browser.host());
            }
            let next = on.iter().filter_map(|it| it.pacing.next(clock, now)).min();
            // Each paint is a copy: input soon after finds the GPU's copies awake (#133).
            if let Some(at) = on.iter().filter_map(|it| it.pacing.painted()).max() {
                copy_wake::painted(at);
            }
            (hosts, next, stalls)
        };
        for host in hosts {
            host.send_external_begin_frame();
        }
        for (surface, found) in stalls {
            self.stalled(surface.as_deref(), found);
        }
        next
    }
}

/// The page of `it` asked at `at`, having waited `waited` since its first ask: a stall its watch
/// finds now, counted once in its view's counts. Only a plugin surface's page is loaded again.
fn watch(it: &OnClock<'_>, at: Instant, waited: Duration) -> Option<Found> {
    let mut view = it.view.lock();
    let paints = view.counts.paints + view.counts.software_paints;
    let found = view.watch.asked(at, waited, paints, it.surface.is_some());
    if found.is_some() && !view.counts.stalled {
        view.counts.stalls += 1;
    }
    view.counts.stalled = view.watch.stalled();
    found
}

/// The frames a view has painted, either way, as its watch sees them: a paint ends a stall.
fn painted(view: &SharedView) -> u64 {
    let mut view = view.lock();
    let paints = view.counts.paints + view.counts.software_paints;
    view.watch.saw(paints);
    view.counts.stalled = view.watch.stalled();
    paints
}
