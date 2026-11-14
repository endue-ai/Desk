//! Web views (#273, ADR 0216): a plugin window's live web page. A view is a windowless browser of
//! its own, as a plugin surface's is, that shows a remote page: on the desk's frame clock, its
//! paints attached as surface `web:<its window's surface host>`, which the compositor draws over
//! that surface at the box the plugin gave (`web.place`), its input routed to it. It is none of
//! the desk's pages: its client answers no bridge call and relays no post (`web_client.rs`), its
//! renderer gets no `__deskNative` (`renderer.rs`), it loads no desk scheme and no file
//! (`web_rules.rs`), and its cookies, cache and storage live in a request context of their own
//! under `web/` in CEF's root. The core owns each view per caller (`desk_core::WebViews`) and
//! says where its page may go. A view lives with its window's surface: hidden while that is not
//! drawn, closed when it sleeps, goes away or moves out to an OS window.

use std::collections::HashMap;
use std::sync::Arc;

use cef::*;
use desk_core::{WebError, WebPlace, WebState};

use super::lifecycle::{Action, State};
use super::view::{SharedView, View};
use super::web_rules::{BLANK, surface_of};
use super::{DEFAULT_PACE, Record, WebHost, drag, frames, render, web_client};

/// One window's web view.
pub(super) struct WebView {
    /// The id the core gave it.
    pub(super) id: String,
    pub(super) place: WebPlace,
    /// The keys go to its page rather than to its window's plugin: a press in it or `web.focus`
    /// gave them, a press on the plugin's own surface takes them back.
    pub(super) keys: bool,
    pub(super) state: WebState,
    /// Where it was sent before its browser was made.
    pending: Option<String>,
}

/// The web views, by their window's surface host, and the request context they share.
#[derive(Default)]
pub(super) struct Views {
    pub(super) by_host: HashMap<String, WebView>,
    context: Option<RequestContext>,
}

impl Views {
    pub(super) fn host_of(&self, view: &str) -> Option<String> {
        (self.by_host.iter())
            .find(|(_, v)| v.id == view)
            .map(|(host, _)| host.clone())
    }
}

/// The size a view's page is laid out at: its box, a pixel at least.
fn size_of(place: &WebPlace) -> (u32, u32) {
    let px = |v: f64| v.round().clamp(1.0, 16384.0) as u32;
    (px(place.width), px(place.height))
}

/// Whether a view at `place` shows at all.
pub(super) fn shows(place: &WebPlace) -> bool {
    place.shown && place.width >= 1.0 && place.height >= 1.0
}

pub(super) fn missing(view: &str) -> WebError {
    WebError::NotFound(format!("no web view {view} is open"))
}

impl WebHost {
    /// The request context every view shares: its cookies, cache and storage apart from the
    /// desk's own pages, which load from the global one.
    fn web_context(&self) -> Option<RequestContext> {
        if let Some(context) = self.inner().web.context.clone() {
            return Some(context);
        }
        let path = crate::paths::cef_root().join("web");
        let _ = std::fs::create_dir_all(&path);
        let settings = RequestContextSettings {
            cache_path: path.to_string_lossy().as_ref().into(),
            ..Default::default()
        };
        let context = request_context_create_context(Some(&settings), None);
        self.inner().web.context.clone_from(&context);
        context
    }

    /// Open view `view` in the window whose surface host is `host`, hidden until it is placed, on
    /// `url` if any. The window's surface must be an off-screen one of the desk's.
    pub fn web_open(&self, host: &str, view: &str, url: Option<&str>) -> Result<(), WebError> {
        {
            let inner = self.inner();
            if inner.apps.is_out(host) {
                return Err(WebError::Unsupported(
                    "a web view shows in the desk only: this window is out of the canvas".into(),
                ));
            }
            if !inner.records.contains_key(host) {
                return Err(WebError::NotFound(format!("{host} shows no surface")));
            }
        }
        // The core closed the view this window had; a browser left of it goes too.
        self.web_drop(host);
        let surface = surface_of(host);
        let scale = self
            .inner()
            .records
            .get(host)
            .map_or(1.0, |r| r.view.lock().scale);
        let shared = SharedView::new(View::new(&surface, (1, 1), scale, true));
        let record = Record {
            plugin: String::new(),
            state: State::Live { hidden: true },
            view: shared.clone(),
            browser: None,
            // A remote page gets no script of the desk's to ask for frames with: it keeps the
            // slow frames instead of resting, so a change of its own is painted within one.
            pacing: frames::Pacing::new(DEFAULT_PACE).restless(),
            drag: drag::DragIds::default(),
            composing: None,
        };
        let place = WebPlace {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
            shown: false,
        };
        {
            let mut inner = self.inner();
            inner.records.insert(surface.clone(), record);
            let web = WebView {
                id: view.to_owned(),
                place,
                keys: false,
                state: WebState::default(),
                pending: None,
            };
            inner.web.by_host.insert(host.to_owned(), web);
        }
        let render =
            render::SurfaceRender::new(shared.clone(), Arc::clone(&self.sink), self.room());
        let client = web_client::client(self, &surface, render);
        let mut client = super::field_menu::client(client, shared.clone());
        let info = WindowInfo {
            windowless_rendering_enabled: 1,
            shared_texture_enabled: i32::from(self.shared_textures),
            external_begin_frame_enabled: 1,
            ..Default::default()
        };
        // White where the page paints nothing, as a browser's window is.
        let settings = BrowserSettings {
            windowless_frame_rate: DEFAULT_PACE as i32,
            background_color: 0xFFFF_FFFF,
            ..Default::default()
        };
        // The renderer leaves the desk's bridge out of this browser's pages (`renderer.rs`).
        let mut extra = dictionary_value_create();
        if let Some(extra) = &extra {
            extra.set_bool(Some(&crate::renderer::WEB_VIEW.into()), 1);
        }
        shared.lock().restart();
        // Not `create_browser_sync`: the views' request context may still be starting (a first
        // view opened as its plugin starts), and CEF makes no browser in one that is not up yet.
        // Made this way the browser comes once the context is, in `web_created`.
        let mut context = self.web_context();
        let made = browser_host_create_browser(
            Some(&info),
            Some(&mut client),
            Some(&url.unwrap_or(BLANK).into()),
            Some(&settings),
            extra.as_mut(),
            context.as_mut(),
        );
        if made != 1 {
            self.web_drop(host);
            return Err(WebError::Failed("the view's browser did not open".into()));
        }
        Ok(())
    }

    /// The browser of view surface `surface` was made: it is the view's from now on, hidden or
    /// shown as the view is now, and goes where the view was sent meanwhile. One made for a view
    /// that ended before it came closes.
    pub(super) fn web_created(&self, surface: &str, browser: &Browser) {
        let (hidden, pending) = {
            let mut inner = self.inner();
            let pending = super::web_rules::host_of(surface)
                .and_then(|host| inner.web.by_host.get_mut(host))
                .and_then(|view| view.pending.take());
            let Some(record) = inner
                .records
                .get_mut(surface)
                .filter(|r| r.browser.is_none())
            else {
                drop(inner);
                if let Some(host) = browser.host() {
                    host.close_browser(1);
                }
                return;
            };
            record.browser = Some(browser.clone());
            (record.state.hidden(), pending)
        };
        if let Some(host) = browser.host() {
            host.was_hidden(i32::from(hidden));
        }
        if let (Some(url), Some(frame)) = (pending, browser.main_frame()) {
            frame.load_url(Some(&url.as_str().into()));
        }
    }

    /// View `view` lies at `place` in its window's surface from now on; the next look lays its
    /// page out and shows or hides it (`web_laid_out`).
    pub fn web_place(&self, view: &str, place: WebPlace) -> Result<(), WebError> {
        let mut inner = self.inner();
        let host = inner.web.host_of(view).ok_or_else(|| missing(view))?;
        if let Some(web) = inner.web.by_host.get_mut(&host) {
            web.place = place;
        }
        Ok(())
    }

    /// The browser of view `view`.
    fn web_browser(&self, view: &str) -> Result<Browser, WebError> {
        let inner = self.inner();
        let host = inner.web.host_of(view).ok_or_else(|| missing(view))?;
        (inner.records.get(&surface_of(&host)))
            .and_then(|r| r.browser.clone())
            .ok_or_else(|| missing(view))
    }

    /// Load `url` in view `view`: now, or once its browser is made.
    pub fn web_load(&self, view: &str, url: &str) -> Result<(), WebError> {
        if let Ok(browser) = self.web_browser(view) {
            let frame = browser.main_frame().ok_or_else(|| missing(view))?;
            frame.load_url(Some(&url.into()));
            return Ok(());
        }
        let mut inner = self.inner();
        let host = inner.web.host_of(view).ok_or_else(|| missing(view))?;
        if let Some(web) = inner.web.by_host.get_mut(&host) {
            web.pending = Some(url.to_owned());
        }
        Ok(())
    }

    pub fn web_go(&self, view: &str, step: desk_bridge::WebStep) -> Result<(), WebError> {
        use desk_bridge::WebStep as S;
        let browser = self.web_browser(view)?;
        match step {
            S::Back => browser.go_back(),
            S::Forward => browser.go_forward(),
            S::Reload => browser.reload(),
            S::Stop => browser.stop_load(),
        }
        Ok(())
    }

    /// Close view `view`; one that is gone already is no error. The core forgot it already.
    pub fn web_close(&self, view: &str) {
        let host = self.inner().web.host_of(view);
        if let Some(host) = host {
            self.web_drop(&host);
        }
    }

    /// The view of the window whose surface host is `host`, if it has one, ends: its surface
    /// slept, went away or moved out of the desk. The core hears its last state.
    pub fn web_end(&self, host: &str) {
        if let Some(view) = self.web_drop(host)
            && let Some(desk) = &self.desk
        {
            let last = WebState {
                closed: true,
                ..WebState::default()
            };
            desk.core.web_changed(&view, last);
        }
    }

    /// Forget the view at `host` and close its browser; its id, if there was one.
    fn web_drop(&self, host: &str) -> Option<String> {
        let (view, browser) = {
            let mut inner = self.inner();
            let view = inner.web.by_host.remove(host)?;
            let record = inner.records.remove(&surface_of(host));
            (view.id, record.and_then(|r| r.browser))
        };
        if let Some(host) = browser.and_then(|b| b.host()) {
            host.close_browser(1);
        }
        Some(view)
    }

    /// The surfaces of the views open now.
    pub fn web_surfaces(&self) -> Vec<String> {
        let inner = self.inner();
        inner.web.by_host.keys().map(|h| surface_of(h)).collect()
    }

    /// Where each view that shows lies in its window's surface, by that surface's host: what
    /// the scene draws (`compositor_window/draw_web.rs`).
    pub fn web_boxes(&self) -> HashMap<String, [f32; 4]> {
        let inner = self.inner();
        (inner.web.by_host.iter())
            .filter(|(_, v)| shows(&v.place))
            .map(|(host, v)| {
                let p = &v.place;
                let at = [p.x as f32, p.y as f32, p.width as f32, p.height as f32];
                (host.clone(), at)
            })
            .collect()
    }

    /// Lay every view's page out at its box and scale, and hide the ones that do not show now:
    /// `drawn` says whether the surface with that host is drawn live. A view whose window's
    /// surface is gone from the host (it slept, it was destroyed, it moved out) ends.
    pub fn web_laid_out(&self, drawn: &dyn Fn(&str) -> bool, scale: f32) {
        let now = std::time::Instant::now();
        let (mut acts, mut ended) = (Vec::new(), Vec::new());
        {
            let mut inner = self.inner();
            let hosts: Vec<String> = inner.web.by_host.keys().cloned().collect();
            for host in hosts {
                if !inner.records.contains_key(&host) {
                    ended.push(host);
                    continue;
                }
                let place = inner.web.by_host[&host].place;
                let surface = surface_of(&host);
                let Some(record) = inner.records.get_mut(&surface) else {
                    continue;
                };
                let hidden = !(shows(&place) && drawn(&host));
                let mut view = record.view.lock();
                // A hidden view keeps the size it had: nothing lays it out.
                let size = if hidden { view.size } else { size_of(&place) };
                let resized = view.size != size || view.scale != scale;
                let shown_again = view.hidden != hidden;
                (view.size, view.scale, view.hidden) = (size, scale, hidden);
                drop(view);
                record.state = State::Live { hidden };
                if resized || shown_again {
                    record.pacing.heard(now);
                }
                let (view, browser) = (record.view.clone(), record.browser.clone());
                if resized {
                    acts.push((
                        surface.clone(),
                        Action::Resize,
                        view.clone(),
                        browser.clone(),
                    ));
                }
                if shown_again {
                    acts.push((surface, Action::Hide(hidden), view, browser));
                }
            }
        }
        for host in ended {
            self.web_end(&host);
        }
        for (surface, action, view, browser) in acts {
            self.act(&surface, action, &view, browser.as_ref(), DEFAULT_PACE);
        }
    }
}

#[cfg(test)]
#[path = "web_views_tests.rs"]
mod tests;
