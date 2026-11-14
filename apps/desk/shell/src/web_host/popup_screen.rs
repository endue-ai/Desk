//! The screen a surface's view reports (#156, B6b): the whole app window, the view at its place in
//! it, so that Chromium places a page's popup widget (a select's list, a date, time or colour
//! picker) as on a desktop: under its field, or above it where there is no room below, shifted
//! sideways to stay on the screen, past the view's edges where it is larger than its pane. Chromium
//! places a popup in its screen's available rect from where it thinks the view is (the view rect's
//! origin, `GetViewRect`), and hands the place back in the view's pixels (`OnPopupSize`), which the
//! compositor draws whole (`compositor_window/draw_popup.rs`). The available rect is the app
//! window less the desk's bars, its free area (`desk_wm::host::Bars::free`), as a desktop's leaves
//! out its menu bar and dock: a popup drawn under the rail or the dock could not be reached there.
//! Before, a view's screen was itself, so a picker taller than a small window's pane was squeezed
//! into it and cut there.
//!
//! The compositor says where it draws each surface every time it lays the desk out
//! (`WebHost::placed`); a browser hears it only once the view rests there (`SETTLE`), its last
//! paint at its size and another since it was last told, with no popup open
//! (`WebHost::tell_screens`, on each turn of the event loop), through `NotifyScreenInfoChanged`,
//! and gets desk frames to paint with it, a window's own page a whole frame of its view too, which
//! ends the hold CEF puts on the view's next resize (#270): a window dragged or gliding tells its
//! page nothing until it stops, a resize in flight is never laid out again past CEF's hold by it
//! (ADR 0170), and no screen is told while CEF still holds the last one; a new scale tells it with
//! the scale (`View::rescaled`). What a browser was told is what its handler answers from then on
//! (`Screen::tell`), a new browser of the surface included, so the place Chromium hands back is in
//! the view it placed the popup from. Until the compositor has drawn a view, its screen is itself,
//! as before.

use std::time::{Duration, Instant};

use cef::{ImplBrowser, ImplBrowserHost, PaintElementType, Rect};

use super::super::WebHost;
use super::super::lifecycle::State;
use super::super::view::View;
use super::super::window_pages::is_window_page;

/// How long a view rests at a new place before its browser hears it.
pub const SETTLE: Duration = Duration::from_millis(150);

/// The app window, in CSS pixels: its size, and where popups go in it, `[x, y, w, h]` (its free
/// area, within it).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct App {
    pub width: i32,
    pub height: i32,
    pub free: [i32; 4],
}

impl App {
    /// A `size` app window whose free area is `free`, in whole pixels, the free area kept inside.
    pub fn new(size: (f64, f64), free: [f64; 4]) -> App {
        let px = |v: f64| v.round() as i32;
        let (width, height) = (px(size.0).max(1), px(size.1).max(1));
        let [x, y, w, h] = free.map(px);
        let (x0, y0) = (x.clamp(0, width - 1), y.clamp(0, height - 1));
        let (x1, y1) = ((x + w).clamp(x0 + 1, width), (y + h).clamp(y0 + 1, height));
        App {
            width,
            height,
            free: [x0, y0, x1 - x0, y1 - y0],
        }
    }
}

/// Where the compositor draws a view: its top left in the app window, and the app window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Placed {
    pub x: i32,
    pub y: i32,
    pub app: App,
}

impl Placed {
    /// A view whose top left is at `(x, y)` in `app`, rounded to whole pixels.
    pub fn new(x: f32, y: f32, app: App) -> Placed {
        Placed {
            x: x.round() as i32,
            y: y.round() as i32,
            app,
        }
    }
}

/// A view's screen: where the compositor draws it now, since when, and what its browser was told.
#[derive(Clone, Debug, Default)]
pub struct Screen {
    now: Option<(Placed, Instant)>,
    told: Option<Placed>,
    /// The view's paints when its browser was told: CEF holds the view's bounds where they were
    /// until the page paints at the surface id the telling gave it, and a screen told meanwhile
    /// never reaches the page (`CefRenderWidgetHostViewOSR::ResizeRootLayer`).
    painted: u64,
    /// A whole frame was asked of the view since its browser was last told (`ask_frame`).
    asked: bool,
}

impl Screen {
    /// The compositor draws the view at `placed`, seen at `at`.
    pub fn placed(&mut self, placed: Placed, at: Instant) {
        if self.now.map(|(p, _)| p) != Some(placed) {
            self.now = Some((placed, at));
        }
    }

    /// Whether its browser should hear its screen at `now`: it is drawn somewhere it was not told,
    /// has rested there `SETTLE`, and its view is `settled` (no resize in flight, no popup open).
    pub fn due(&self, now: Instant, settled: bool) -> bool {
        let Some((placed, since)) = self.now else {
            return false;
        };
        settled && self.told != Some(placed) && now.saturating_duration_since(since) >= SETTLE
    }

    /// Its browser reads its screen now (it is told), its view having painted `paints` frames:
    /// its handler answers that from now on.
    pub fn tell(&mut self, paints: u64) {
        self.told = self.now.map(|(p, _)| p).or(self.told);
        self.painted = paints;
        self.asked = false;
    }

    /// Whether CEF holds the view's resizes: its browser was told its screen and the view, at
    /// `paints` frames, has painted none since. A page the telling leaves looking as it did paints
    /// nothing of its own, so the hold stays, and a size sent meanwhile waits behind it for good:
    /// a plugin's window snapped or stretched after it had moved kept its content at the old size
    /// through every catch-up (ADR 0210), until something else made its page paint.
    pub fn held(&self, paints: u64) -> bool {
        self.told.is_some() && paints <= self.painted
    }

    /// Whether a resize of the view, at `paints` frames, asks it for a whole frame: CEF holds it
    /// (`held`) and none was asked of it since its screen was told. Once a telling, as ADR 0214
    /// gives a window's own page one: a page that paints nothing for it (covered, asleep) was
    /// asked again at every size of a glide, 274 times in a second of the motion gate's loop.
    pub fn ask_frame(&mut self, paints: u64) -> bool {
        let ask = self.held(paints) && !self.asked;
        self.asked |= ask;
        ask
    }

    /// The view's rect on its screen, `size` its own size (never empty, as CEF asks).
    pub fn view_rect(&self, (width, height): (u32, u32)) -> Rect {
        let (x, y) = self.told.map_or((0, 0), |p| (p.x, p.y));
        Rect {
            x,
            y,
            width: width.max(1) as i32,
            height: height.max(1) as i32,
        }
    }

    /// Its screen's rect, and the part popups go in: the app window and its free area, or the view
    /// itself while it is drawn nowhere yet.
    pub fn rects(&self, size: (u32, u32)) -> (Rect, Rect) {
        let Some(App {
            width,
            height,
            free: [x, y, w, h],
        }) = self.told.map(|p| p.app)
        else {
            let own = || Rect {
                x: 0,
                ..self.view_rect(size)
            };
            return (own(), own());
        };
        let whole = Rect {
            x: 0,
            y: 0,
            width,
            height,
        };
        let free = Rect {
            x,
            y,
            width: w,
            height: h,
        };
        (whole, free)
    }
}

/// The frames a view has painted, either way.
pub fn paints(view: &View) -> u64 {
    view.painted()
}

/// Whether a view can hear a new screen: shown, its last paint at its size (no resize CEF holds),
/// a paint since it was last told (no screen CEF holds either) and no popup open (one placed in
/// the old screen stays where it is drawn).
fn settled(view: &View) -> bool {
    let painted = paints(view) > view.screen.painted;
    !view.hidden && view.at_size() && painted && view.popup.place().is_none()
}

/// `view` has a new size: its browser `host` hears it. The screen's info goes with it only for a
/// new scale: with every resize it stalled a page whose window glides to a new size (#157,
/// `View::rescaled`). While CEF still holds the view where its screen was told (`Screen::held`), a
/// whole frame of it is asked for too, once a telling and of a view that shows (one shown again is
/// asked for one anyway, `Action::Hide`): the paint ends the hold, and the size goes through after
/// it. Each such frame is traced (`held`).
pub fn resized(host: &cef::BrowserHost, view: &super::super::view::SharedView) {
    let (rescaled, held) = {
        let mut view = view.lock();
        let painted = paints(&view);
        let ask = !view.hidden && view.screen.ask_frame(painted);
        (view.rescaled(), ask.then(|| view.surface.clone()))
    };
    if rescaled {
        host.notify_screen_info_changed();
    }
    host.was_resized();
    if let Some(surface) = held {
        crate::frame_trace::line("held", serde_json::json!({ "surface": surface }));
        host.invalidate(PaintElementType::VIEW);
    }
}

impl WebHost {
    /// The compositor drew each of `placed` (a surface, its top left) in `app` at `now`; the
    /// surfaces it did not draw keep where they were.
    pub fn placed(&self, placed: &[(String, (f32, f32))], app: App, now: Instant) {
        let inner = self.inner();
        for (surface, (x, y)) in placed {
            if let Some(record) = inner.records.get(surface) {
                let at = Placed::new(*x, *y, app);
                record.view.lock().screen.placed(at, now);
            }
        }
    }

    /// Where `surface`'s browser was told its view is, `[x, y]`, and its app window, `[w, h]`, for
    /// checks (`compositor_stats`).
    pub fn told(&self, surface: &str) -> Option<[i32; 4]> {
        let inner = self.inner();
        let told = inner.records.get(surface)?.view.lock().screen.told?;
        Some([told.x, told.y, told.app.width, told.app.height])
    }

    /// Tell every shown browser whose view rests somewhere new its screen (on the UI thread).
    pub fn tell_screens(&self, now: Instant) {
        let browsers: Vec<(cef::Browser, bool)> = {
            let inner = self.inner();
            (inner.records.iter())
                .filter(|(_, r)| r.state == State::Live { hidden: false })
                .filter_map(|(surface, r)| {
                    let browser = r.browser.as_ref()?;
                    let mut view = r.view.lock();
                    let (due, paints) = (view.screen.due(now, settled(&view)), paints(&view));
                    // A browser is taken (a reference CEF counts) only for a view that is due.
                    due.then(|| view.screen.tell(paints))
                        .map(|_| (browser.clone(), is_window_page(surface)))
                })
                .collect()
        };
        for (browser, window_page) in browsers {
            if let Some(host) = browser.host() {
                // Its screen rects and info again: the view's place, the app window; no new size.
                host.notify_screen_info_changed();
                // CEF holds every resize from now on until the view paints again
                // (`ResizeRootLayer`), and a window's page the telling leaves looking as it did
                // paints nothing of its own: its section fills it, its title bar is still. A whole
                // frame of it ends the hold. Without one, a window moved and then resized kept its
                // page at the old size (#270). A plugin's page is left as it was: it paints of its
                // own, and ADR 0210 catches up one that does not.
                if window_page {
                    host.invalidate(PaintElementType::VIEW);
                }
            }
            // Frames for it to paint at the surface id that came with it.
            super::super::frames::heard(browser.identifier(), false);
        }
    }
}

#[cfg(test)]
#[path = "popup_screen_tests.rs"]
mod tests;
