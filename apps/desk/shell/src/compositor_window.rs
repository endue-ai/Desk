//! The desk's main window (#52, #83): a wgpu scene that `desk-compositor` draws, the only desk
//! there is since Stage 1's windowed one, whose page drew the plugins' frames itself, went (ADR
//! 0156). The window manager (`desk-wm`) places it (#81, ADR 0151): the shell page publishes the
//! desk the runtime keeps (`compositor_desk`), `hosted.rs` mirrors it into a plan, the live budget
//! and the surfaces' lifecycle, and `draw.rs` draws every window with the compositor's own chrome
//! in the theme in force, each plugin pane an off-screen browser of its own (`web_host`), and the
//! page's system layer above them. The page renders off screen too, see through, its windows'
//! chrome left to the compositor. Input (#56) goes through the compositor's router to the surface
//! it is for (`input.rs`), and first through `desk-wm`'s window manager, which drags, resizes,
//! snaps and pans (`wm.rs`, #80, ADR 0153); the compositor draws a page's hover title
//! (`tooltip.rs`, #156). Every surface and the page render on the desk's frame clock (`clock.rs`,
//! ADR 0152). Screen readers see the desk as one tree through an AccessKit adapter (`a11y.rs`,
//! #57). The spread (`spread.rs`), the canvas map (`minimap.rs`) and every surface's snapshot for
//! the core (`snapshots.rs`) draw on the surfaces' live and last textures (#54, ADR 0161).

pub mod a11y;
pub mod a11y_check;
mod a11y_chrome;
pub mod checks;
mod clock;
pub mod commands;
mod compose;
pub mod composed;
pub mod cursor;
pub mod draw;
mod draw_map;
mod draw_pane;
mod draw_popup;
mod draw_spread;
mod draw_web;
mod gpu;
mod handed;
pub mod harness;
pub mod hosted;
pub mod input;
mod minimap;
mod motion;
mod os_pointer;
pub mod overlay;
mod page;
pub mod report;
mod snapshots;
mod spread;
mod steps;
pub mod system;
mod tooltip;
mod web;
pub mod winit_input;
pub mod wm;

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
use serde_json::json;
use winit::event_loop::ActiveEventLoop;
use winit::window::Window;

use crate::host::Desk;
use crate::native_host::NativeHost;
use crate::web_host::frames::FRAME;
use crate::web_host::relay::Relay;
use crate::web_host::view::{SharedView, View};
use crate::web_host::{WebHost, top};
use composed::Shared;
use hosted::{Hosted, Outcome, look, motion, owner};
use report::DeskReport;

/// The shell page's id as a surface.
pub const PAGE: &str = "desk";
/// What the runtime hears: the windows that keep a renderer (ADR 0151).
pub const LIVE: &str = "desk://compositor-live";
/// An image asked of the window this late held the event loop for it.
const SLOW_IMAGE: Duration = Duration::from_millis(250);
/// So many late images in a row and the window presents nothing for a while (`gpu::PAUSED`).
const SLOW_IMAGES: u32 = 3;

/// The compositor window and everything it draws.
pub struct CompositorWindow {
    pub window: Arc<Window>,
    gpu: gpu::Gpu,
    shared: Shared,
    pub host: WebHost,
    /// Native plugins' surfaces, each its own process (#59).
    native: NativeHost,
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
    /// Frames composed for the window, and those it presented.
    composed: u64,
    presented: u64,
    /// The late images in a row.
    slow_presents: u32,
    /// Where input goes (#56).
    router: InputRouter,
    cursors: cursor::Cursors,
    /// The text the page's IME composes now.
    page_composing: Option<String>,
    /// An OS drag follows the OS pointer; a check that places the pointer itself turns it off.
    pub follow_os_pointer: bool,
    /// What the window manager keeps between events (#80).
    gestures: wm::Gestures,
    /// The window's accessibility (#57).
    a11y: a11y::A11y,
    /// The system parts the last scene drew whole, and its system layer back to front (ADR 0160).
    parts: (Vec<String>, Vec<String>),
    /// The spread while it is open, and the canvas map (#54).
    spreading: spread::Spreading,
    mapping: minimap::Mapping,
    /// The pages' hover titles, which the compositor draws (#156).
    tips: tooltip::Tips,
}

impl CompositorWindow {
    /// Open the compositor window: `window` (made unseen, shown once its accessibility adapter is
    /// on, as AccessKit asks), with no surface yet; the desk's system surface comes next
    /// (`open_page`, ADR 0160).
    pub fn open(
        event_loop: &ActiveEventLoop,
        window: Arc<Window>,
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
        let native = NativeHost::new(Arc::new(shared.clone()), relay.clone(), Arc::clone(&desk));
        let size = window.inner_size().to_logical::<f64>(window.scale_factor());
        let logical = (size.width.round() as u32, size.height.round() as u32);
        let page = SharedView::new(View::new(
            PAGE,
            logical,
            window.scale_factor() as f32,
            false,
        ));
        let physical = window.inner_size();
        let settings = PointerSettings {
            underlay: Some(PAGE.to_owned()),
            pages: Some(crate::web_host::window_pages::SURFACE.to_owned()),
            ..PointerSettings::default()
        };
        let mut router = InputRouter::new(Platform::current(), settings);
        router.targets.set_owner(PAGE, "desk");
        let themes = desk.core.watch_theme_tokens();
        let table = desk.core.theme_tokens();
        let theme = look(&table);
        let mut hosted = Hosted::new(window.scale_factor());
        hosted.wm.set_motion(motion(&table));
        let mut opened = CompositorWindow {
            hosted,
            window,
            gpu,
            shared,
            host,
            native,
            relay,
            page,
            browser: None,
            theme,
            themes,
            scene: Scene::new(physical.width, physical.height),
            desk,
            occluded: false,
            last_frame: Instant::now() - FRAME,
            begin_due: None,
            composed: 0,
            presented: 0,
            slow_presents: 0,
            router,
            cursors: cursor::Cursors::default(),
            page_composing: None,
            follow_os_pointer: true,
            gestures: wm::Gestures::default(),
            a11y: a11y::A11y::default(),
            parts: (Vec::new(), Vec::new()),
            spreading: spread::Spreading::default(),
            mapping: minimap::Mapping::default(),
            tips: tooltip::Tips::default(),
        };
        opened.stand_in();
        opened.attach_a11y(event_loop);
        let snapshots = snapshots::Snapshots::new(opened.desk.pump.clone());
        opened
            .desk
            .core
            .set_surface_snapshots(Some(Arc::new(snapshots)));
        let web = web::Web::new(opened.desk.pump.clone());
        opened.desk.core.set_web_views(Some(Arc::new(web)));
        opened.window.set_visible(true);
        Ok(opened)
    }

    /// The shell page published its desk.
    pub fn report(&mut self, report: DeskReport) {
        crate::frame_trace::line("report", json!({}));
        let outcome = self.hosted.apply(report, Instant::now());
        self.carry(outcome);
        self.run_deferred();
    }

    /// The window has a new size or scale: the page lays out again.
    pub fn resized(&mut self) {
        let physical = self.window.inner_size();
        self.gpu.resize(physical.width, physical.height);
        self.scene.resize(physical.width, physical.height);
        let scale = self.window.scale_factor();
        let size = physical.to_logical::<f64>(scale);
        let size = (size.width.round() as u32, size.height.round() as u32);
        self.page_resized(size, scale as f32);
        let outcome = self.hosted.rescale(scale, Instant::now());
        self.carry(outcome);
    }

    /// The window went off screen or came back: every surface is hidden, or shown again, and a
    /// window that could not present presents again.
    pub fn occluded(&mut self, occluded: bool) {
        // A headless desk under a frame trace measures, whatever covers its window (#247).
        let occluded = occluded && !(self.gpu.headless() && crate::frame_trace::on());
        self.occluded = occluded;
        if !occluded {
            self.gpu.resume();
        }
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

    /// After CEF's work: act on what the surfaces said, on a new look and on the budget's time,
    /// send the frame clock's begin frames and draw a frame if one is due.
    pub fn tick(&mut self, now: Instant, event_loop: &ActiveEventLoop) {
        self.page_painted(now);
        let messages = std::mem::take(&mut self.shared.lock().messages);
        for message in messages {
            if let SurfaceMessage::SurfaceA11yUpdate(update) = message {
                self.a11y_update(update);
                continue;
            }
            if !matches!(
                message,
                SurfaceMessage::SurfaceDied(_)
                    | SurfaceMessage::SurfaceReady(_)
                    | SurfaceMessage::SurfaceTitle(_)
            ) {
                self.surface_said(event_loop, &message);
                continue;
            }
            // A surface came, went or was named: the accessibility tree follows.
            self.a11y.changed();
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
            // A new look restyles every window's chrome in the next frame, and its motion moves
            // the glides.
            self.theme = look(&table);
            self.hosted.wm.set_motion(motion(&table));
            self.shared.lock().dirty = true;
        }
        let outcome = self.hosted.tick(now);
        if outcome != Outcome::default() {
            self.carry(outcome);
        }
        if self.hosted.take_restaged() {
            self.shared.lock().dirty = true;
        }
        self.spread_tick(now);
        if self.hosted.moving() {
            // A window glides, or the snap preview: a frame after another until it arrives.
            self.shared.lock().dirty = true;
        }
        self.input_tick(event_loop);
        self.tip_tick(now);
        self.a11y_tick();
        self.begin_frames(now);
        // The OS withheld the last frame (a locked screen): one now means the window shows again.
        if self.due().withheld().is_some_and(|until| now >= until) && self.gpu.frame().is_some() {
            self.shared.lock().dirty = true;
        }
        // Out of sight, nothing is due: what changed meanwhile is drawn once it shows (#155).
        if !self.due().frame().is_some_and(|at| now >= at) {
            return;
        }
        // The motion gate's frame trace times each frame (#247, `frame_trace.rs`).
        let mut timed = crate::frame_trace::Timed::begin(|| self.shared.lock().dirty);
        self.scene_for_frame();
        timed.mark();
        self.composed += 1;
        self.last_frame = clock::Due::beat(self.last_frame, now);
        if !self.gpu.presents() {
            return self.unseen(timed);
        }
        let started = Instant::now();
        let frame = self.gpu.frame();
        timed.mark();
        let slow = started.elapsed() > SLOW_IMAGE;
        self.slow_presents = if slow { self.slow_presents + 1 } else { 0 };
        let shown = frame.is_some();
        match frame {
            Some(frame) => self.present(frame),
            // Composed for the router and captures, shown nowhere: not again until a change,
            // where it composed every desk frame for nothing (#134).
            None if self.gpu.withheld().is_some() => self.shared.lock().drawn(),
            None => {}
        }
        timed.end(self.composed, shown);
        if self.slow_presents >= SLOW_IMAGES {
            // A locked screen, a display going off: the images come late, each holding the loop.
            // The frame in hand went out first; its surface stays (`gpu.rs`).
            eprintln!(
                "endue Desk: the window cannot present; composing off screen only for {:?}",
                gpu::PAUSED
            );
            self.gpu.stop_presenting(now);
        }
    }

    /// The composed scene into `frame`, to the window.
    fn present(&mut self, frame: wgpu::SurfaceTexture) {
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let size = (frame.texture.width(), frame.texture.height());
        let mut composed = self.shared.lock();
        composed.compositor.invalidate();
        composed.compositor.render(&self.scene, &view, size);
        composed.drawn();
        drop(composed);
        self.window.pre_present_notify();
        self.gpu.queue.present(frame);
        self.presented += 1;
    }

    /// Close the page's browser and every surface's (the desk quits).
    pub fn close(&self) {
        self.desk.core.set_surface_snapshots(None);
        self.desk.core.set_web_views(None);
        self.host.close_all();
        self.native.close_all();
        self.relay.page(None);
        top::set_shell_page(None);
    }
}
