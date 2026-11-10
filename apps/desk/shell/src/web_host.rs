//! The web host (#52, #32 §4): the surface protocol's (`specs/surface/v0`, ADR 0141) implementation
//! for web content. Each surface is one windowless CEF browser (`shared_texture_enabled`) that
//! renders on the desk's frame clock (external begin frames, ADR 0152: `frames.rs`, `clock.rs`): its
//! paints reach the compositor as `attach`es with their damage (`render.rs`); `resize` lays it out
//! again (`WasResized`, the device scale through its screen info); `hide` is `WasHidden`; `sleep`
//! closes the browser, so its renderer exits; `wake` opens it again; `pace` is its windowless frame
//! rate and its share of the desk's frames; its renderer's death is `died`, its load `ready`, its
//! title `title`. The compositor sees only the protocol, never CEF (`SurfaceSink`). Each surface has
//! an origin of its own (#36), so with `--site-per-process` each is its own renderer; DevTools reach
//! each one over the remote debugging port in development builds (ADR 0144).

pub mod client;
pub mod clock;
pub mod cursor;
pub mod drag;
pub mod frames;
pub mod input;
pub mod key_codes;
pub mod lifecycle;
pub mod paint;
pub mod relay;
pub mod render;
pub mod routes;
pub mod shim;
pub mod stand_in;
pub mod view;

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use cef::*;
use desk_compositor::{AttachError, Attached, Source};
use desk_surface::generated::{
    CompositorMessage, SurfaceAttach, SurfaceDied, SurfaceDiedType, SurfaceMessage, SurfaceReady,
    SurfaceReadyType, SurfaceTitle, SurfaceTitleType,
};

use crate::host::Desk;
use lifecycle::{Action, State, size_of, surface_of};
use relay::Relay;
use view::{Counts, SharedView, View};

/// Where a web surface's messages go: the compositor, in this process.
pub trait SurfaceSink: Send + Sync {
    /// A frame, inside the engine's paint callback: done with `source` when this returns.
    fn attach(&self, attach: &SurfaceAttach, source: Source<'_>) -> Result<Attached, AttachError>;
    /// Every other message: `ready`, `died`, `title`.
    fn message(&self, message: SurfaceMessage);
    /// The compositor's device, for frames the engine imports or the host uploads itself.
    fn device(&self) -> (wgpu::Device, wgpu::Queue);
}

/// The most frames per second a surface paints until the compositor says otherwise.
pub const DEFAULT_PACE: u32 = 60;

struct Record {
    plugin: String,
    state: State,
    view: SharedView,
    browser: Option<Browser>,
    /// Its place on the desk's frame clock, its pace with it.
    pacing: frames::Pacing,
    /// The ids that join the page's drag messages to the broker's (#56).
    drag: drag::DragIds,
    /// The text the surface's IME composes now.
    composing: Option<String>,
}

#[derive(Default)]
struct Inner {
    records: HashMap<String, Record>,
    /// The document each surface shows, set by whoever knows it (the stand-in's URL).
    sources: HashMap<String, String>,
    /// The desk's frames, and the compositor's page on them (`clock.rs`).
    clock: frames::Clock,
    page: Option<clock::Page>,
}

/// The web host. Cheap to clone; every clone is the same host. Call it on CEF's UI thread.
#[derive(Clone)]
pub struct WebHost {
    inner: Arc<Mutex<Inner>>,
    sink: Arc<dyn SurfaceSink>,
    relay: Relay,
    desk: Option<Arc<Desk>>,
    /// Paint into shared textures (off only to try the software path).
    shared_textures: bool,
}

impl WebHost {
    /// A host whose surfaces' messages go to `sink`; `desk` answers their pages' bridge calls.
    pub fn new(sink: Arc<dyn SurfaceSink>, relay: Relay, desk: Option<Arc<Desk>>) -> WebHost {
        WebHost {
            inner: Arc::default(),
            sink,
            relay,
            desk,
            shared_textures: std::env::var_os("DESK_SURFACE_SOFTWARE").is_none(),
        }
    }

    fn inner(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn relay(&self) -> &Relay {
        &self.relay
    }

    /// Surface `surface` shows the document at `url` (before its `create`, or a new one later: a new
    /// revision, a reload), which its browser loads when it is live.
    pub fn load(&self, surface: &str, url: &str) {
        let frame = {
            let mut inner = self.inner();
            inner.sources.insert(surface.to_owned(), url.to_owned());
            let record = inner.records.get(surface);
            let live = record.is_some_and(|r| matches!(r.state, State::Live { .. }));
            live.then(|| {
                record
                    .and_then(|r| r.browser.as_ref())
                    .and_then(|b| b.main_frame())
            })
            .flatten()
        };
        if let Some(frame) = frame {
            frame.load_url(Some(&url.into()));
        }
    }

    /// A message from the compositor.
    pub fn send(&self, message: &CompositorMessage) {
        let Some(surface) = surface_of(message) else {
            return;
        };
        if self.route(&surface, message) {
            return;
        }
        let (actions, view, browser, pace) = {
            let mut inner = self.inner();
            let state = inner.records.get(&surface).map(|r| r.state);
            let (next, actions) = lifecycle::step(state, message);
            if let CompositorMessage::SurfaceCreate(create) = message
                && actions.contains(&Action::Open {
                    hidden: next.is_some_and(State::hidden),
                })
            {
                let size = (create.size.width as u32, create.size.height as u32);
                let view = View::new(
                    &surface,
                    size,
                    create.scale as f32,
                    create.hidden == Some(true),
                );
                let record = Record {
                    plugin: create.plugin.clone(),
                    state: State::Gone,
                    view: SharedView::new(view),
                    browser: None,
                    pacing: frames::Pacing::new(DEFAULT_PACE),
                    drag: drag::DragIds::default(),
                    composing: None,
                };
                inner.records.insert(surface.clone(), record);
            }
            let Some(record) = inner.records.get_mut(&surface) else {
                return;
            };
            if let Some(next) = next {
                record.state = next;
            }
            {
                let mut view = record.view.lock();
                if let Some((size, scale)) = size_of(message) {
                    view.size = size;
                    view.scale = scale;
                }
                view.hidden = record.state.hidden();
            }
            for action in &actions {
                if let Action::Pace(fps) = action {
                    record.pacing.set_pace(*fps);
                }
            }
            (
                actions,
                record.view.clone(),
                record.browser.clone(),
                record.pacing.pace(),
            )
        };
        for action in actions {
            self.act(&surface, action, &view, browser.as_ref(), pace);
        }
        if matches!(message, CompositorMessage::SurfaceDestroy(_)) && browser.is_none() {
            self.inner().records.remove(&surface);
        }
    }

    fn act(
        &self,
        surface: &str,
        action: Action,
        view: &SharedView,
        browser: Option<&Browser>,
        pace: u32,
    ) {
        let host = browser.and_then(|b| b.host());
        match action {
            Action::Open { hidden } => self.open(surface, view, hidden, pace),
            Action::Resize => {
                if let Some(host) = host {
                    host.notify_screen_info_changed();
                    host.was_resized();
                }
            }
            Action::Hide(hidden) => {
                if let Some(host) = host {
                    host.was_hidden(i32::from(hidden));
                    if !hidden {
                        // Shown again, past ten browsers that were hidden together only some
                        // paint again until they lay out once more (the probe's `many`).
                        host.was_resized();
                        host.invalidate(PaintElementType::VIEW);
                    }
                }
            }
            Action::Restart => {
                view.lock().restart();
                // The surface's document as it is now (a new revision may have come meanwhile).
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
            Action::Pace(fps) => {
                if let Some(host) = host {
                    host.set_windowless_frame_rate(fps.min(60) as i32);
                }
            }
            Action::Close => {
                self.relay.surface(surface, None);
                if let Some(host) = host {
                    host.close_browser(1);
                }
            }
        }
    }

    fn open(&self, surface: &str, view: &SharedView, hidden: bool, pace: u32) {
        let url = self.inner().sources.get(surface).cloned();
        let Some(url) = url else {
            eprintln!("endue Desk: surface {surface} has no document to show");
            return;
        };
        view.lock().restart();
        let render = render::SurfaceRender::new(view.clone(), Arc::clone(&self.sink));
        let mut client = client::client(self, surface, render, self.desk.clone());
        let info = WindowInfo {
            windowless_rendering_enabled: 1,
            shared_texture_enabled: i32::from(self.shared_textures),
            external_begin_frame_enabled: 1,
            ..Default::default()
        };
        // Transparent where the page paints nothing, as the frame was over its window.
        let settings = BrowserSettings {
            windowless_frame_rate: pace.min(60) as i32,
            background_color: 0,
            ..Default::default()
        };
        let browser = browser_host_create_browser_sync(
            Some(&info),
            Some(&mut client),
            Some(&url.as_str().into()),
            Some(&settings),
            None,
            None,
        );
        // Made shown and hidden at once (`WasHidden`): a windowless browser made with
        // `WindowInfo::hidden` never started its frames once shown.
        if hidden && let Some(host) = browser.as_ref().and_then(|b| b.host()) {
            host.was_hidden(1);
        }
        self.relay.surface(surface, browser.clone());
        if let Some(record) = self.inner().records.get_mut(surface) {
            record.browser = browser;
        }
    }

    /// The surface's page loaded: it is `ready`.
    pub fn loaded(&self, surface: &str) {
        self.sink
            .message(SurfaceMessage::SurfaceReady(SurfaceReady {
                r#type: SurfaceReadyType::Ready,
                surface: surface.to_owned(),
            }));
    }

    /// The surface's page has a new title.
    pub fn titled(&self, surface: &str, title: String) {
        self.sink
            .message(SurfaceMessage::SurfaceTitle(SurfaceTitle {
                r#type: SurfaceTitleType::Title,
                surface: surface.to_owned(),
                title,
            }));
    }

    /// The renderer of browser `browser` of `surface` ended without being asked.
    pub fn died(&self, surface: &str, browser: i32, status: TerminationStatus, code: i32) {
        let died = {
            let mut inner = self.inner();
            let Some(record) = inner.records.get_mut(surface) else {
                return;
            };
            let current = record
                .browser
                .as_ref()
                .is_some_and(|b| b.identifier() == browser);
            let was = record.state;
            record.state = was.died();
            current && record.state != was
        };
        if died {
            self.sink.message(SurfaceMessage::SurfaceDied(SurfaceDied {
                r#type: SurfaceDiedType::Died,
                surface: surface.to_owned(),
                reason: lifecycle::death_reason(status),
                exit_code: Some(i64::from(code)),
            }));
        }
    }

    /// Browser `browser` of `surface` closed: a destroyed surface is gone with it.
    pub fn closed(&self, surface: &str, browser: i32) {
        let mut inner = self.inner();
        let Some(record) = inner.records.get_mut(surface) else {
            return;
        };
        if record
            .browser
            .as_ref()
            .is_some_and(|b| b.identifier() == browser)
        {
            record.browser = None;
        }
        if record.state == State::Gone && record.browser.is_none() {
            inner.records.remove(surface);
        }
    }

    /// Close every browser (the desk quits); `browsers` says how many are still open.
    pub fn close_all(&self) {
        let hosts: Vec<BrowserHost> = {
            let mut inner = self.inner();
            for record in inner.records.values_mut() {
                record.state = State::Gone;
            }
            inner
                .records
                .values()
                .filter_map(|r| r.browser.as_ref()?.host())
                .collect()
        };
        for host in hosts {
            host.close_browser(1);
        }
    }

    /// How many browsers are open.
    pub fn browsers(&self) -> usize {
        self.inner()
            .records
            .values()
            .filter(|r| r.browser.is_some())
            .count()
    }

    /// What surface `surface` painted, its state and its plugin, for stats and probes.
    pub fn counts(&self, surface: &str) -> Option<(Counts, State, String)> {
        let inner = self.inner();
        let record = inner.records.get(surface)?;
        let counts = record.view.lock().counts.clone();
        Some((counts, record.state, record.plugin.clone()))
    }

    /// Every surface's id.
    pub fn surfaces(&self) -> Vec<String> {
        self.inner().records.keys().cloned().collect()
    }

    /// The browser of `surface`, while it has one.
    pub fn browser(&self, surface: &str) -> Option<Browser> {
        self.inner().records.get(surface)?.browser.clone()
    }
}
