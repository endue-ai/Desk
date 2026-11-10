//! Compositor mode (#52, `DESK_COMPOSITOR=1` or `--compositor`): the main window is a wgpu scene
//! that `desk-compositor` draws. The window manager's model (`desk-wm`) places it (#81, ADR 0151):
//! the shell page publishes the desk the runtime keeps (`compositor_desk`), `hosted.rs` mirrors it
//! into a plan, the live budget and the surfaces' lifecycle, and `draw.rs` draws every window with
//! the compositor's own chrome in the theme in force, each plugin pane an off-screen browser of its
//! own (`web_host`), and the page's system layer above them. The page renders off screen too, see
//! through, its windows' chrome left to the compositor. Without the mode the desk is Stage 1's
//! windowed one, unchanged. Input (#56) goes through the compositor's router to the surface it is
//! for (`input.rs`); the runtime's window manager stays in the page until #83. Every surface and
//! the page render on the desk's frame clock (`clock.rs`, ADR 0152).

pub mod checks;
mod clock;
pub mod commands;
pub mod composed;
pub mod cursor;
pub mod draw;
mod gpu;
pub mod harness;
pub mod hosted;
pub mod input;
mod os_pointer;
pub mod overlay;
pub mod report;
pub mod winit_input;

use std::sync::Arc;
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

use cef::*;
use desk_compositor::input::keymap::Platform;
use desk_compositor::input::{InputRouter, PointerSettings};
use desk_compositor::{ChromeTheme, Compositor, Scene};
use desk_core::TokenTable;
use desk_surface::generated::SurfaceMessage;
use desk_web::sender::Role;
use desk_wm::Step;
use serde_json::json;
use winit::event_loop::ActiveEventLoop;
use winit::window::Window;

use crate::host::Desk;
use crate::web_host::frames::FRAME;
use crate::web_host::relay::Relay;
use crate::web_host::render::SurfaceRender;
use crate::web_host::view::{SharedView, View};
use crate::web_host::{WebHost, stand_in};
use composed::Shared;
use hosted::{Hosted, Outcome, look, message, owner};
use report::DeskReport;

/// The shell page's id as a surface.
pub const PAGE: &str = "desk";
/// What the runtime hears: the windows that keep a renderer (ADR 0151).
pub const LIVE: &str = "desk://compositor-live";

/// Whether this start asks for compositor mode.
pub fn enabled() -> bool {
    std::env::var("DESK_COMPOSITOR").is_ok_and(|v| v == "1")
        || std::env::args().any(|a| a == "--compositor")
}

/// The URL of the shell page in compositor mode: the page publishes its desk.
pub fn page_url(url: &str) -> String {
    let joiner = if url.contains('?') { '&' } else { '?' };
    format!("{url}{joiner}compositor=1")
}

/// The compositor window and everything it draws.
pub struct CompositorWindow {
    pub window: Arc<Window>,
    gpu: gpu::Gpu,
    shared: Shared,
    pub host: WebHost,
    relay: Relay,
    page: SharedView,
    pub browser: Option<Browser>,
    hosted: Hosted,
    theme: ChromeTheme,
    themes: Receiver<Arc<TokenTable>>,
    scene: Scene,
    desk: Arc<Desk>,
    occluded: bool,
    last_frame: Instant,
    /// When the frame clock looks next (`clock.rs`).
    begin_due: Option<Instant>,
    presented: u64,
    slow_presents: u32,
    /// Where input goes (#56).
    router: InputRouter,
    cursors: cursor::Cursors,
    /// The text the page's IME composes now.
    page_composing: Option<String>,
    /// An OS drag follows the OS pointer; a check that places the pointer itself turns it off.
    pub follow_os_pointer: bool,
}

impl CompositorWindow {
    /// Open the compositor window: `window` and the shell page at `url` as its first surface.
    pub fn open(
        window: Arc<Window>,
        url: &str,
        desk: Arc<Desk>,
    ) -> Result<CompositorWindow, String> {
        let headless = std::env::var_os("DESK_COMPOSITOR_HEADLESS").is_some();
        let gpu = gpu::Gpu::new(Arc::clone(&window), headless)?;
        eprintln!(
            "endue Desk: compositor mode on {} ({:?})",
            gpu.adapter.name, gpu.adapter.backend
        );
        let shared = Shared::new(Compositor::new(&gpu.device, &gpu.queue, gpu.format));
        let relay = Relay::default();
        let host = WebHost::new(
            Arc::new(shared.clone()),
            relay.clone(),
            Some(Arc::clone(&desk)),
        );
        let size = window.inner_size().to_logical::<f64>(window.scale_factor());
        let logical = (size.width.round() as u32, size.height.round() as u32);
        let page = SharedView::new(View::new(
            PAGE,
            logical,
            window.scale_factor() as f32,
            false,
        ));
        let render = SurfaceRender::new(page.clone(), Arc::new(shared.clone()));
        let mut client = crate::client::compositor_page(
            desk.pump.clone(),
            Arc::clone(&desk),
            render,
            relay.clone(),
        );
        let info = WindowInfo {
            windowless_rendering_enabled: 1,
            shared_texture_enabled: i32::from(std::env::var_os("DESK_SURFACE_SOFTWARE").is_none()),
            external_begin_frame_enabled: 1,
            ..Default::default()
        };
        // See through: the compositor draws the wallpaper and the windows under the page.
        let settings = BrowserSettings {
            windowless_frame_rate: 60,
            background_color: 0,
            ..Default::default()
        };
        let browser = browser_host_create_browser_sync(
            Some(&info),
            Some(&mut client),
            Some(&page_url(url).as_str().into()),
            Some(&settings),
            None,
            None,
        );
        stand_in::set_shell_page(browser.as_ref().map(|b| b.identifier()));
        host.clock_page(browser.clone(), page.clone());
        let physical = window.inner_size();
        let settings = PointerSettings {
            underlay: Some(PAGE.to_owned()),
            ..PointerSettings::default()
        };
        let mut router = InputRouter::new(Platform::current(), settings);
        router.targets.set_owner(PAGE, "desk");
        let themes = desk.core.watch_theme_tokens();
        let theme = look(&desk.core.theme_tokens());
        Ok(CompositorWindow {
            hosted: Hosted::new(window.scale_factor()),
            window,
            gpu,
            shared,
            host,
            relay,
            page,
            browser,
            theme,
            themes,
            scene: Scene::new(physical.width, physical.height),
            desk,
            occluded: false,
            last_frame: Instant::now() - FRAME,
            begin_due: None,
            presented: 0,
            slow_presents: 0,
            router,
            cursors: cursor::Cursors::default(),
            page_composing: None,
            follow_os_pointer: true,
        })
    }

    /// The shell page published its desk.
    pub fn report(&mut self, report: DeskReport) {
        let outcome = self.hosted.apply(report, Instant::now());
        self.carry(outcome);
    }

    /// Do what a look called for: the surfaces' steps, and the live set for the runtime.
    fn carry(&mut self, outcome: Outcome) {
        for step in &outcome.steps {
            if let Step::Load { surface, url } = step {
                self.host.load(surface, url);
                continue;
            }
            let Some(message) = message(step) else {
                continue;
            };
            match step {
                Step::Destroy { surface } => {
                    self.shared.lock().destroy(surface);
                    self.forget(surface);
                }
                // Its process goes: its imports with it, its last frame (a copy) stays.
                Step::Sleep { surface } => {
                    let mut composed = self.shared.lock();
                    if let Some(id) = composed.texture_of(surface) {
                        composed.frames.ended(id);
                    }
                    drop(composed);
                    self.forget(surface);
                }
                _ => {}
            }
            self.host.send(&message);
        }
        if let Some(live) = outcome.live {
            self.desk
                .pages
                .emit(Role::Main, LIVE, json!({ "live": live }));
        }
        self.shared.lock().dirty = true;
    }

    /// The window has a new size or scale: the page lays out again.
    pub fn resized(&mut self) {
        let physical = self.window.inner_size();
        self.gpu.resize(physical.width, physical.height);
        self.scene.resize(physical.width, physical.height);
        let scale = self.window.scale_factor();
        let size = physical.to_logical::<f64>(scale);
        {
            let mut page = self.page.lock();
            page.size = (size.width.round() as u32, size.height.round() as u32);
            page.scale = scale as f32;
        }
        if let Some(host) = self.browser.as_ref().and_then(|b| b.host()) {
            host.notify_screen_info_changed();
            host.was_resized();
        }
        let outcome = self.hosted.rescale(scale, Instant::now());
        self.carry(outcome);
    }

    /// The window went off screen or came back: every surface is hidden, or shown again.
    pub fn occluded(&mut self, occluded: bool) {
        self.occluded = occluded;
        self.page.lock().hidden = occluded;
        self.host.page_shown(!occluded);
        if let Some(host) = self.browser.as_ref().and_then(|b| b.host()) {
            host.was_hidden(i32::from(occluded));
            if !occluded {
                host.was_resized();
            }
        }
        let outcome = self.hosted.occluded(occluded, Instant::now());
        self.carry(outcome);
    }

    /// Surface `surface` takes no input any more (destroyed, asleep, died).
    fn forget(&mut self, surface: &str) {
        let _ = self.router.forget(surface);
        self.router.targets.forget(surface);
    }

    /// After CEF's work: act on what the surfaces said, on a new look and on the budget's time,
    /// send the frame clock's begin frames and draw a frame if one is due.
    pub fn tick(&mut self, now: Instant, event_loop: &ActiveEventLoop) {
        let messages = std::mem::take(&mut self.shared.lock().messages);
        for message in messages {
            if !matches!(
                message,
                SurfaceMessage::SurfaceDied(_)
                    | SurfaceMessage::SurfaceReady(_)
                    | SurfaceMessage::SurfaceTitle(_)
            ) {
                self.surface_said(event_loop, &message);
                continue;
            }
            if let SurfaceMessage::SurfaceDied(died) = message {
                self.forget(&died.surface);
                // The direct signal for #44's recovery: the runtime loads the window again.
                self.hosted.died(&died.surface);
                self.shared.lock().dirty = true;
                if let Some((plugin, _)) = owner(&died.surface) {
                    eprintln!(
                        "endue Desk: the renderer of {plugin} stopped ({:?})",
                        died.reason
                    );
                    let event = json!({ "plugin": plugin });
                    self.desk
                        .pages
                        .emit(Role::Main, crate::crashes::CRASHED, event);
                }
            }
        }
        if let Some(table) = self.themes.try_iter().last() {
            // A new look restyles every window's chrome in the next frame.
            self.theme = look(&table);
            self.shared.lock().dirty = true;
        }
        let outcome = self.hosted.tick(now);
        if outcome != Outcome::default() {
            self.carry(outcome);
        }
        self.input_tick(event_loop);
        self.begin_frames(now);
        if !self.shared.lock().dirty || now < self.last_frame + FRAME || self.occluded {
            return;
        }
        self.compose();
        if !self.gpu.presents() {
            return;
        }
        self.last_frame = now;
        let started = Instant::now();
        let Some(frame) = self.gpu.frame() else {
            return;
        };
        if started.elapsed() > Duration::from_millis(250) {
            self.slow_presents += 1;
            if self.slow_presents == 3 {
                // A locked screen hands out no drawable: compose for captures only from now on.
                eprintln!("endue Desk: the window cannot present; composing off screen only");
                self.gpu.stop_presenting();
            }
        }
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let size = (frame.texture.width(), frame.texture.height());
        let mut composed = self.shared.lock();
        composed.compositor.invalidate();
        composed.compositor.render(&self.scene, &view, size);
        composed.dirty = false;
        drop(composed);
        self.window.pre_present_notify();
        self.gpu.queue.present(frame);
        self.presented += 1;
    }

    /// Lay the scene out again from the hosted desk and the frames the surfaces attached, and tell
    /// the input router what each node shows.
    pub(super) fn compose(&mut self) {
        let drawn = {
            let composed = self.shared.lock();
            let texture = |surface: &str| {
                let id = composed.texture_of(surface)?;
                Some((id, composed.frames.size(id)?))
            };
            let sources = draw::Sources {
                scale: self.window.scale_factor() as f32,
                page: texture(PAGE),
                surface: &texture,
            };
            draw::draw(&mut self.scene, &self.theme, &self.hosted, &sources)
        };
        let shown = drawn.unwrap_or_else(|why| {
            eprintln!("endue Desk: the compositor's scene did not build ({why:?})");
            Vec::new()
        });
        if !self.gpu.presents() {
            self.shared.lock().dirty = false;
        }
        self.register(shown);
    }

    /// Close the page's browser and every surface's (the desk quits).
    pub fn close(&self) {
        self.host.close_all();
        stand_in::set_shell_page(None);
    }
}
