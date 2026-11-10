//! Compositor mode (#52, `DESK_COMPOSITOR=1` or `--compositor`): the main window is a wgpu scene
//! that `desk-compositor` draws. The shell page renders off screen as one surface over the whole
//! window; every plugin surface is an off-screen browser of its own (`web_host`), drawn as quads at
//! the rectangles the runtime places its frames (`layout.rs`, `scene.rs`), whose stand-ins relay the
//! runtime's messages. Without the mode the desk is Stage 1's windowed one, unchanged. Input reaches
//! nothing yet (#56); the window manager stays in the runtime until #53.

pub mod commands;
pub mod composed;
mod gpu;
pub mod layout;
pub mod scene;

use std::sync::Arc;
use std::time::{Duration, Instant};

use cef::*;
use desk_compositor::{Compositor, Scene};
use desk_surface::generated::SurfaceMessage;
use desk_web::sender::Role;
use serde_json::{Value, json};
use winit::window::Window;

use crate::host::Desk;
use crate::web_host::relay::Relay;
use crate::web_host::render::SurfaceRender;
use crate::web_host::view::{SharedView, View};
use crate::web_host::{WebHost, stand_in};
use composed::Shared;
use layout::{Layout, Report, Step};

/// The shell page's id as a surface.
pub const PAGE: &str = "desk";
/// The longest a frame waits for the next one: the display's rate, at most.
const FRAME: Duration = Duration::from_micros(16_667);

/// Whether this start asks for compositor mode.
pub fn enabled() -> bool {
    std::env::var("DESK_COMPOSITOR").is_ok_and(|v| v == "1")
        || std::env::args().any(|a| a == "--compositor")
}

/// The URL of the shell page in compositor mode: the page reports its plugin frames' places.
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
    layout: Layout,
    scene: Scene,
    desk: Arc<Desk>,
    occluded: bool,
    last_frame: Instant,
    presented: u64,
    slow_presents: u32,
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
            ..Default::default()
        };
        let settings = BrowserSettings {
            windowless_frame_rate: 60,
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
        let physical = window.inner_size();
        Ok(CompositorWindow {
            window,
            gpu,
            shared,
            host,
            relay,
            page,
            browser,
            layout: Layout::default(),
            scene: Scene::new(physical.width, physical.height),
            desk,
            occluded: false,
            last_frame: Instant::now() - FRAME,
            presented: 0,
            slow_presents: 0,
        })
    }

    /// The shell page reported where its plugin frames are.
    pub fn report(&mut self, report: Report) {
        let steps = self.layout.apply(report);
        self.run(steps);
        self.shared.lock().dirty = true;
    }

    fn run(&self, steps: Vec<Step>) {
        for step in steps {
            match step {
                Step::Load { surface, url } => self.host.load(&surface, &url),
                Step::Send(message) => {
                    use desk_surface::generated::CompositorMessage as M;
                    match &message {
                        M::SurfaceDestroy(d) => self.shared.lock().destroy(&d.surface),
                        // Its process goes: its imports with it, its last frame (a copy) stays.
                        M::SurfaceSleep(s) => {
                            let mut composed = self.shared.lock();
                            if let Some(id) = composed.texture_of(&s.surface) {
                                composed.frames.ended(id);
                            }
                        }
                        _ => {}
                    }
                    self.host.send(&message);
                }
            }
        }
    }

    /// The window has a new size or scale: the page lays out again.
    pub fn resized(&mut self) {
        let physical = self.window.inner_size();
        self.gpu.resize(physical.width, physical.height);
        self.scene.resize(physical.width, physical.height);
        let size = physical.to_logical::<f64>(self.window.scale_factor());
        {
            let mut page = self.page.lock();
            page.size = (size.width.round() as u32, size.height.round() as u32);
            page.scale = self.window.scale_factor() as f32;
        }
        if let Some(host) = self.browser.as_ref().and_then(|b| b.host()) {
            host.notify_screen_info_changed();
            host.was_resized();
        }
        self.shared.lock().dirty = true;
    }

    /// The window went off screen or came back: every surface is hidden, or shown again.
    pub fn occluded(&mut self, occluded: bool) {
        self.occluded = occluded;
        self.page.lock().hidden = occluded;
        if let Some(host) = self.browser.as_ref().and_then(|b| b.host()) {
            host.was_hidden(i32::from(occluded));
            if !occluded {
                host.was_resized();
            }
        }
        let steps = self.layout.occluded(occluded);
        self.run(steps);
    }

    /// The window is in front (the display's rate) or behind (a lower one).
    pub fn focused(&self, focused: bool) {
        self.run(self.layout.pace(if focused { 60 } else { 30 }));
    }

    /// After CEF's work: act on what the surfaces said, and draw a frame if one is due.
    pub fn tick(&mut self, now: Instant) {
        let messages = std::mem::take(&mut self.shared.lock().messages);
        for message in messages {
            if let SurfaceMessage::SurfaceDied(died) = message {
                // The direct signal for #44's recovery: the runtime reloads the window's frame.
                self.layout.died(&died.surface);
                if let Some((plugin, _)) = layout::owner(&died.surface) {
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

    /// When the next frame may be drawn.
    pub fn next_frame(&self) -> Option<Instant> {
        self.shared.lock().dirty.then_some(self.last_frame + FRAME)
    }

    /// Lay the scene out again from the layout and the frames the surfaces attached.
    fn compose(&mut self) {
        let mut composed = self.shared.lock();
        let page = composed
            .texture_of(PAGE)
            .filter(|id| composed.frames.size(*id).is_some());
        let scale = self.layout.scale.max(0.25);
        let mut quads = Vec::new();
        for placed in self.layout.placed.iter().filter(|p| !p.asleep) {
            let Some(id) = composed.texture_of(&placed.host) else {
                continue;
            };
            let Some(size) = composed.frames.size(id) else {
                continue;
            };
            quads.extend(scene::pieces(placed, scale, id, size));
        }
        scene::rebuild(&mut self.scene, page, &quads);
        if !self.gpu.presents() {
            composed.dirty = false;
        }
    }

    /// The composed frame as a PNG at `path` (development builds: checks and screenshots).
    pub fn capture(&mut self, path: &str) -> Result<Value, String> {
        self.compose();
        let rgba = self.shared.lock().read(&self.scene).ok_or("no readback")?;
        let (w, h) = self.scene.viewport();
        let file = std::fs::File::create(path).map_err(|e| e.to_string())?;
        let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), w, h);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(&rgba).map_err(|e| e.to_string())?;
        Ok(json!({ "path": path, "width": w, "height": h, "quads": self.scene.len() }))
    }

    /// What each surface did, for checks (development builds).
    pub fn stats(&self) -> Value {
        let composed = self.shared.lock();
        let mut surfaces = serde_json::Map::new();
        for (surface, asleep) in self.layout.surfaces() {
            let (counts, state, plugin) = self
                .host
                .counts(&surface)
                .map_or((json!(null), json!("none"), json!(null)), |(c, s, p)| {
                    (json!(c), json!(format!("{s:?}")), json!(p))
                });
            let attached = composed.attached.get(&surface).copied().unwrap_or_default();
            let texture = composed
                .texture_of(&surface)
                .and_then(|id| composed.frames.size(id));
            let placed = self.layout.placed.iter().find(|p| p.host == surface);
            let pieces: Vec<[f64; 4]> = placed
                .map(|p| {
                    p.pieces
                        .iter()
                        .map(|b| [b.x, b.y, b.width, b.height])
                        .collect()
                })
                .unwrap_or_default();
            surfaces.insert(
                surface,
                json!({ "plugin": plugin, "state": state, "asleep": asleep,
                "counts": counts, "attached": attached.0, "refused": attached.1, "texture": texture,
                "pieces": pieces, "loads": placed.map(|p| p.loads) }),
            );
        }
        let page = self.page.lock().counts.clone();
        json!({
            "page": page,
            "surfaces": surfaces,
            "browsers": self.host.browsers(),
            "relayed": self.relay.counts(),
            "presented": self.presented,
            "slow_presents": self.slow_presents,
            "adapter": format!("{} ({:?})", self.gpu.adapter.name, self.gpu.adapter.backend),
        })
    }

    /// Close the page's browser and every surface's (the desk quits).
    pub fn close(&self) {
        self.host.close_all();
        stand_in::set_shell_page(None);
    }
}
