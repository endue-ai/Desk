//! The compositor's side of the surface protocol in the desk's process: the frames surfaces attach
//! (`desk_compositor::Frames`, the texture import entry), the other messages they send and their
//! pages' hover titles, behind the `SurfaceSink` the web host talks to, and where each surface's
//! popup widget is (#156: its frames attach as a surface of their own, drawn over it). Shared by
//! the compositor window and the surface probe.

use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex, MutexGuard};

use desk_compositor::headless::Target;
use desk_compositor::{AttachError, Attached, Compositor, Frames, Scene, Source, TextureId};
use desk_surface::generated::{SurfaceAttach, SurfaceMessage, SurfacePixelRect};

use crate::web_host::SurfaceSink;
use crate::web_host::render::popup::{self, Place};

/// The most page paints kept between two looks of the window.
const PAGE_PAINTS: usize = 64;

/// What the compositor knows of the surfaces.
pub struct Composed {
    pub compositor: Compositor,
    pub frames: Frames,
    textures: HashMap<String, TextureId>,
    next: u64,
    /// Something changed since the last drawn frame: the scene is laid out again.
    pub dirty: bool,
    /// The textures whose pictures alone changed since the last drawn frame, each a frame of the
    /// size it had (a caret's blink, a page's own animation): the scene is drawn again as it was
    /// laid out (R1, `compose.rs`).
    pub repainted: BTreeSet<TextureId>,
    /// Messages other than frames, for the owner to act on in order.
    pub messages: Vec<SurfaceMessage>,
    /// Frames attached and refused, by surface.
    pub attached: HashMap<String, (u64, u64)>,
    /// The damage of each frame the desk's page attached since the window last looked, in texture
    /// pixels: what its picture shows of the windows (`hosted.rs`, `PageShown`).
    pub page_damage: Vec<Vec<SurfacePixelRect>>,
    /// Where each surface's open popup widget is, in its view's logical pixels.
    pub popups: HashMap<String, Place>,
    /// The hover title each page said last since the window looked (`""`: none, #156).
    pub tips: HashMap<String, String>,
    /// The page's paint of a size no report of it names yet, held aside (#269).
    page: page::PageAside,
    /// Each plugin's paints of a size its pane is not drawn at yet, held aside (ADR 0227).
    panes: pane::Panes,
    /// Each window's own page's paints of a size its panes' plugins have no picture of yet, held
    /// aside (ADR 0233).
    pages: window::Pages,
    /// The textures retired until the render thread drew past them (#249).
    retired: retired::Retired,
}

impl Composed {
    /// The texture id the compositor draws `surface` with.
    pub fn texture(&mut self, surface: &str) -> TextureId {
        if let Some(id) = self.textures.get(surface) {
            return *id;
        }
        self.next += 1;
        let id = TextureId(self.next);
        self.textures.insert(surface.to_owned(), id);
        id
    }

    /// A frame was drawn of everything that changed. A window's page's picture still waiting
    /// asks for the next one, whose scene counts towards ending its wait (ADR 0233).
    pub fn drawn(&mut self) {
        self.dirty = self.pages_waiting();
        self.repainted.clear();
    }

    /// `attach` came for texture `id`, now `size` pixels, `had` before (`taken`).
    fn took(
        &mut self,
        id: TextureId,
        attach: &SurfaceAttach,
        size: (u32, u32),
        had: Option<(u32, u32)>,
    ) {
        if taken(attach, size, had) {
            self.repainted.insert(id);
        } else {
            self.dirty = true;
        }
    }

    /// The texture id of `surface`, if it has one.
    pub fn texture_of(&self, surface: &str) -> Option<TextureId> {
        self.textures.get(surface).copied()
    }

    /// The surfaces with a texture here.
    pub fn surfaces(&self) -> impl Iterator<Item = &str> + '_ {
        self.textures.keys().map(String::as_str)
    }

    /// `surface` is gone: its frames go too, and its popup's.
    pub fn destroy(&mut self, surface: &str) {
        self.close_popup(surface);
        self.pane_gone(surface);
        self.page_wait_gone(surface);
        self.drop_frames(surface);
    }

    fn drop_frames(&mut self, surface: &str) {
        if let Some(id) = self.textures.remove(surface) {
            // A scene handed before may still draw it (`composed_retired.rs`).
            self.retire(id);
            self.dirty = true;
        }
    }

    /// `surface`'s popup closed (or its page went): its place and its frames go.
    fn close_popup(&mut self, surface: &str) {
        self.dirty |= self.popups.remove(surface).is_some();
        self.drop_frames(&popup::id(surface));
    }

    /// Where `surface`'s popup is and the texture it is drawn with, once it painted.
    pub fn popup_of(&self, surface: &str) -> Option<(Place, TextureId, (u32, u32))> {
        let place = *self.popups.get(surface)?;
        let id = self.texture_of(&popup::id(surface))?;
        Some((place, id, self.frames.size(id)?))
    }

    /// Draw `scene` into a fresh off-screen target and read it back (RGBA rows).
    pub fn read(&mut self, scene: &Scene) -> Option<Vec<u8>> {
        let (target, device, queue) = self.drawn_off_screen(scene);
        target.read_rgba(&device, &queue).ok()
    }

    /// `scene` drawn into a fresh off-screen target, to read back once the lock is let go (a
    /// capture's readback holds the render thread up no more, #249), with the device and queue.
    pub fn drawn_off_screen(&mut self, scene: &Scene) -> (Target, wgpu::Device, wgpu::Queue) {
        let size = scene.viewport();
        let device = self.compositor.device().clone();
        let queue = self.compositor.queue().clone();
        let target = Target::new(&device, size, self.compositor.format());
        self.compositor.invalidate();
        self.compositor.render(scene, &target.view, size);
        (target, device, queue)
    }
}

/// Whether a frame `attach`, its texture now `size` pixels and `had` before, changes only its
/// picture: a frame of the size the texture had. The desk's page lays the windows' page parts out
/// from its paints (`PageShown`), so each of its frames lays the scene out again, as a surface's
/// first frame or a new size does.
pub fn taken(attach: &SurfaceAttach, size: (u32, u32), had: Option<(u32, u32)>) -> bool {
    attach.surface != super::PAGE && had == Some(size)
}

/// The compositor's state, shared with the web host's handlers.
#[derive(Clone)]
pub struct Shared(Arc<Mutex<Composed>>);

impl Shared {
    pub fn new(compositor: Compositor) -> Shared {
        Shared(Arc::new(Mutex::new(Composed {
            compositor,
            frames: Frames::new(),
            textures: HashMap::new(),
            next: 0,
            dirty: true,
            repainted: BTreeSet::new(),
            messages: Vec::new(),
            attached: HashMap::new(),
            page_damage: Vec::new(),
            popups: HashMap::new(),
            tips: HashMap::new(),
            page: page::PageAside::default(),
            panes: pane::Panes::default(),
            pages: window::Pages::default(),
            retired: retired::Retired::default(),
        })))
    }

    /// Lock it; never across a call into CEF, whose paint callbacks lock it too.
    pub fn lock(&self) -> MutexGuard<'_, Composed> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl SurfaceSink for Shared {
    fn attach(&self, attach: &SurfaceAttach, source: Source<'_>) -> Result<Attached, AttachError> {
        let mut composed = self.lock();
        let size = (attach.texture.width as u32, attach.texture.height as u32);
        let (id, aside, whole) = if attach.surface == super::PAGE {
            let (id, aside) = composed.page_texture(size);
            (id, aside, false)
        } else if crate::web_host::window_pages::is_window_page(&attach.surface) {
            composed.page_wait_texture(&attach.surface, size)
        } else {
            // A window's page may wait for this plugin's picture: the next scene looks.
            composed.dirty |= composed.pages_waiting();
            composed.pane_texture(&attach.surface, size)
        };
        // A paint shown of another size than its picture goes to a texture of its own (#249).
        let picture = id;
        let id = if aside {
            id
        } else {
            composed.shown_texture(id, size)
        };
        // A paint to another texture than the one before it carries that one's damage only.
        let all = whole.then(|| SurfaceAttach {
            damage: Vec::new(),
            ..attach.clone()
        });
        let attach = all.as_ref().unwrap_or(attach);
        let state = &mut *composed;
        let had = state.frames.size(id);
        let started = std::time::Instant::now();
        let result = state
            .frames
            .attach(&mut state.compositor, id, attach, source);
        if id != picture {
            state.resized(&attach.surface, picture, id, result.is_ok());
        }
        let damage = attach.damage.len();
        crate::frame_trace::attached(&attach.surface, started, damage, result.is_ok());
        let counts = state.attached.entry(attach.surface.clone()).or_default();
        match &result {
            Ok(_) => counts.0 += 1,
            Err(_) => counts.1 += 1,
        }
        if aside {
            // A picture aside that did not take the paint goes, never to be shown at 0×0.
            if result.is_err() {
                state.aside_failed(&attach.surface, id);
            }
            return result;
        }
        if result.is_ok() && attach.surface == super::PAGE {
            // A window that looks no more (the probe's) keeps the last ones only.
            if state.page_damage.len() >= PAGE_PAINTS {
                state.page_damage.remove(0);
            }
            state.page_damage.push(attach.damage.clone());
        }
        if let Ok(attached) = &result {
            state.took(id, attach, attached.size, had);
        }
        result
    }

    fn message(&self, message: SurfaceMessage) {
        let mut composed = self.lock();
        if let SurfaceMessage::SurfaceDied(died) = &message
            && let Some(id) = composed.texture_of(&died.surface)
        {
            // The dead process's imports go; its last frame stays until it loads again.
            composed.frames.ended(id);
        }
        if let SurfaceMessage::SurfaceDied(died) = &message {
            composed.close_popup(&died.surface);
        }
        composed.messages.push(message);
    }

    fn popup(&self, surface: &str, place: Option<Place>) {
        let mut composed = self.lock();
        match place {
            Some(place) => {
                composed.popups.insert(surface.to_owned(), place);
                composed.dirty = true;
            }
            None => composed.close_popup(surface),
        }
    }

    fn tooltip(&self, surface: &str, text: &str) {
        let mut composed = self.lock();
        composed.tips.insert(surface.to_owned(), text.to_owned());
    }

    fn device(&self) -> (wgpu::Device, wgpu::Queue) {
        let composed = self.lock();
        (
            composed.compositor.device().clone(),
            composed.compositor.queue().clone(),
        )
    }
}

#[path = "composed_page.rs"]
mod page;
#[path = "composed_pane.rs"]
mod pane;
#[path = "composed_retired.rs"]
mod retired;
#[path = "composed_window.rs"]
pub mod window;

#[cfg(test)]
#[path = "composed_tests.rs"]
mod tests;
