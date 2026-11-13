//! A size a page has not painted (#248, ADR 0210). A resize reaches a page's renderer one size at a
//! time: Chromium sends the next only once the renderer has drawn the one before (its visual
//! properties' pending ack), and CEF holds a view's next size until a paint at the one before. A
//! glide sends a size a frame, and after one now and then that wait was never met: the renderer
//! kept a size between the glide's ends, its `requestAnimationFrame` never called back, the desk's
//! begin frames went on and the page painted nothing, until the stall watch loaded it again
//! (#157). Without Chromium's full pipeline in the browser process (`pipeline.rs`) a begin frame
//! ends, so this is the one wait left; of a resize, a hide and show, an invalidate, a begin frame of
//! the desk's own and a new frame rate none brought such a page back, and telling its browser the
//! screen again did at once, in every try: it sends the size past that wait.
//!
//! So each view keeps the size its page was last laid out at, and when. Once the size has rested
//! `DUE` with no paint at it, the view shown and begin frames sent it meanwhile (`FED`), its browser
//! hears its screen again with its size (`NotifyScreenInfoChanged`, `WasResized`) and gets desk
//! frames to paint with, again each `DUE` while it still paints nothing at that size, `TIMES` at
//! most: a page that never paints is the stall watch's (`stall.rs`). A window dragged or gliding to
//! a new size moves its size on every frame, so nothing is due until it stops.
//!
//! A page can also stop at its size: in #248's loop one painted nothing for 3 s through 118 begin
//! frames, its size its view's, and the stall watch loaded it again. So the watch's count short of a
//! stall (its page asking again for frames through begin frames, painting nothing, a second and two
//! seconds in) tells its browser the same (`clock.rs`), and only a page that still paints nothing is
//! loaded again. At the last such ask before a stall, a plugin's page is also hidden and shown again
//! on CEF's next task, laid out and painted whole (`shown_again`), as a page shown again after
//! others is (`popup_room.rs`): in #248's loop one page kept the size it had between a glide's ends
//! through five tellings. Each telling is counted (`caught_up`) and traced with why: `size`,
//! `asked` or `shown`.

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use cef::*;
use serde_json::json;

use super::super::WebHost;
use super::super::frames;
use super::super::lifecycle::State;
use super::{SharedView, View};

/// How long a size rests unpainted, begin frames going out, before its browser hears it again.
pub const DUE: Duration = Duration::from_millis(250);
/// The begin frames a view takes meanwhile: a clock held or a view hidden is not a page that missed.
pub const FED: u64 = 3;
/// The tellings for one size.
pub const TIMES: u32 = 3;

/// Whether the desk catches its pages up: always, but in a development build started with
/// `DESK_CATCH_UP=off`, which measures the desk without it (`just perf-motion`, ADR 0210).
fn on() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| {
        !cfg!(debug_assertions) || std::env::var("DESK_CATCH_UP").as_deref() != Ok("off")
    })
}

/// One view's watch over its paints.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CatchUp {
    /// The view's paints at the last look, and whether it was shown then.
    paints: u64,
    shown: bool,
    /// Since when it has waited for a paint at its size, and the begin frames sent it by then.
    since: Option<(Instant, u64)>,
    /// Since when it has been at its size, while it still waits.
    at_size: Option<Instant>,
    /// The tellings since its last paint.
    told: u32,
}

impl CatchUp {
    /// A look at `now`: the view has painted at its size (`at_size`), is `shown`, has painted
    /// `paints` times and been sent `fed` begin frames in all. Whether its browser hears its screen
    /// again now.
    pub fn due(&mut self, now: Instant, at_size: bool, shown: bool, paints: u64, fed: u64) -> bool {
        // A paint or a show starts it over: nothing waits until a size it has not painted.
        if !shown || !self.shown || paints != self.paints {
            *self = CatchUp {
                paints,
                shown,
                ..CatchUp::default()
            };
        }
        if !shown {
            return false;
        }
        // At its size, it waits for nothing; a size its page painted that comes back between two
        // it has not (a live resize back and forth) does not end the wait until it stays `DUE`.
        if at_size {
            let at = *self.at_size.get_or_insert(now);
            if now.saturating_duration_since(at) >= DUE {
                *self = CatchUp {
                    paints,
                    shown,
                    ..CatchUp::default()
                };
            }
            return false;
        }
        self.at_size = None;
        let (since, fed_then) = *self.since.get_or_insert((now, fed));
        let waited = now.saturating_duration_since(since) >= DUE;
        if self.told >= TIMES || !waited || fed.saturating_sub(fed_then) < FED {
            return false;
        }
        self.told += 1;
        self.since = Some((now, fed));
        true
    }
}

/// Whether `view`'s browser hears its screen again at `now` (`CatchUp::due`), counted in its counts.
fn due(view: &mut View, now: Instant) -> bool {
    let (at_size, shown) = (view.at_size(), !view.hidden);
    let (paints, fed) = (view.counts.paints, view.counts.begin_frames);
    let due = view.catch_up.due(now, at_size, shown, paints, fed);
    if due {
        counted(view, "size");
    }
    due
}

/// `view`'s browser hears its screen again, for `why`: `size`, a size its page has not painted, or
/// `asked`, a page that asked for frames again through begin frames and painted nothing (the stall
/// watch's count short of a stall, `clock.rs`). Counted, and traced as `caught_up`.
pub(crate) fn counted(view: &mut View, why: &str) {
    view.counts.caught_up += 1;
    let (size, texture) = (view.pixels(), view.counts.texture);
    let fields = json!({ "surface": view.surface, "size": size, "texture": texture, "why": why });
    crate::frame_trace::line("caught_up", fields);
}

/// Tell `browser` its screen and size again, and give it desk frames to paint them with.
pub(crate) fn tell(browser: &Browser) {
    if let Some(host) = browser.host() {
        host.notify_screen_info_changed();
        host.was_resized();
    }
    frames::heard(browser.identifier(), false);
}

/// The last try before the stall watch loads a plugin's page again (`clock.rs`): hide `browser`
/// now and, on CEF's next task, show it again if its view is still shown, then tell it its screen
/// and size and have it paint whole: its frame evicted, it lays out once more for a new surface id.
pub(crate) fn shown_again(browser: &Browser, view: SharedView) {
    let Some(host) = browser.host() else { return };
    host.was_hidden(1);
    let mut task = ShowAgain::new(browser.clone(), view);
    post_task(ThreadId::UI, Some(&mut task));
}

wrap_task! {
    struct ShowAgain {
        browser: Browser,
        view: SharedView,
    }

    impl Task {
        fn execute(&self) {
            let Some(host) = self.browser.host() else { return };
            if self.view.lock().hidden {
                return;
            }
            host.was_hidden(0);
            host.invalidate(PaintElementType::VIEW);
            tell(&self.browser);
        }
    }
}

impl WebHost {
    /// Tell every shown browser whose page has not painted its size `DUE` after it came its screen
    /// and size again (on the UI thread).
    pub fn catch_up(&self, now: Instant) {
        if !on() {
            return;
        }
        let browsers: Vec<Browser> = {
            let inner = self.inner();
            (inner.records.values())
                .filter(|r| r.state == State::Live { hidden: false })
                .filter_map(|r| {
                    let browser = r.browser.as_ref()?;
                    due(&mut r.view.lock(), now).then(|| browser.clone())
                })
                .collect()
        };
        browsers.iter().for_each(tell);
    }
}

/// The desk's own page, which the host does not make (`compositor_window/page.rs`): the same.
pub fn catch_up_page(view: &SharedView, browser: Option<&Browser>, now: Instant) {
    if let Some(browser) = browser
        && on()
        && due(&mut view.lock(), now)
    {
        tell(browser);
    }
}

#[cfg(test)]
#[path = "catch_up_tests.rs"]
mod tests;
