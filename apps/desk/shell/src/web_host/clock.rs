//! The web host's side of the desk's frame clock (#111, #117, `frames.rs`): each look sends a begin
//! frame (`SendExternalBeginFrame`) to every browser the clock takes at that moment: the surfaces on
//! it, and the compositor's own shell page while it is shown, which the host does not make but
//! paints on the same clock. What the browsers heard since the last look starts their prompt frames
//! or wakes them, and the next look is the soonest any of them wants.

use std::time::Instant;

use cef::*;

use super::frames::{self, Pacing};
use super::view::SharedView;
use super::{Inner, WebHost, copy_wake};

/// The compositor's shell page on the clock.
pub struct Page {
    pub(super) browser: Browser,
    pub(super) view: SharedView,
    pacing: Pacing,
    shown: bool,
}

/// A browser on the clock now: its pacing and its view (which counts paints and begin frames).
struct OnClock<'a> {
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
        let (hosts, next) = {
            let mut inner = self.inner();
            let Inner {
                records,
                clock,
                page,
                ..
            } = &mut *inner;
            let mut on: Vec<OnClock<'_>> = records
                .values_mut()
                .filter(|r| frames::on_clock(r.state))
                .filter_map(|r| {
                    Some(OnClock {
                        browser: r.browser.as_ref()?,
                        pacing: &mut r.pacing,
                        view: &r.view,
                    })
                })
                .chain(page.iter_mut().filter(|p| p.shown).map(|p| OnClock {
                    browser: &p.browser,
                    pacing: &mut p.pacing,
                    view: &p.view,
                }))
                .collect();
            for (id, at, prompt) in heard {
                if let Some(it) = on.iter_mut().find(|it| it.browser.identifier() == id) {
                    if prompt {
                        let painted = paints(it.view);
                        it.pacing.press(at, painted);
                    } else {
                        it.pacing.heard(at);
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
                if !it.pacing.due(now, frame, paints(it.view)) {
                    continue;
                }
                it.view.lock().counts.begin_frames += 1;
                hosts.extend(it.browser.host());
            }
            let next = on.iter().filter_map(|it| it.pacing.next(clock, now)).min();
            // Each paint is a copy: input soon after finds the GPU's copies awake (#133).
            if let Some(at) = on.iter().filter_map(|it| it.pacing.painted()).max() {
                copy_wake::painted(at);
            }
            (hosts, next)
        };
        for host in hosts {
            host.send_external_begin_frame();
        }
        next
    }
}

/// The frames a view has painted, either way.
fn paints(view: &SharedView) -> u64 {
    let view = view.lock();
    view.counts.paints + view.counts.software_paints
}
