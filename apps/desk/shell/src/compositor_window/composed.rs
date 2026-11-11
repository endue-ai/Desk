//! The compositor's side of the surface protocol in the desk's process: the frames surfaces attach
//! (`desk_compositor::Frames`, the texture import entry) and the other messages they send, behind
//! the `SurfaceSink` the web host talks to, and where each surface's popup widget is (#156: its
//! frames attach as a surface of their own, drawn over it). Shared by the compositor window and the
//! surface probe.

use std::collections::HashMap;
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
    /// Something changed since the last drawn frame.
    pub dirty: bool,
    /// Messages other than frames, for the owner to act on in order.
    pub messages: Vec<SurfaceMessage>,
    /// Frames attached and refused, by surface.
    pub attached: HashMap<String, (u64, u64)>,
    /// The damage of each frame the desk's page attached since the window last looked, in texture
    /// pixels: what its picture shows of the windows (`hosted.rs`, `PageShown`).
    pub page_damage: Vec<Vec<SurfacePixelRect>>,
    /// Where each surface's open popup widget is, in its view's logical pixels.
    pub popups: HashMap<String, Place>,
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

    /// The texture id of `surface`, if it has one.
    pub fn texture_of(&self, surface: &str) -> Option<TextureId> {
        self.textures.get(surface).copied()
    }

    /// `surface` is gone: its frames go too, and its popup's.
    pub fn destroy(&mut self, surface: &str) {
        self.close_popup(surface);
        self.drop_frames(surface);
    }

    fn drop_frames(&mut self, surface: &str) {
        if let Some(id) = self.textures.remove(surface) {
            self.frames.destroy(&mut self.compositor, id);
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
        let size = scene.viewport();
        let device = self.compositor.device().clone();
        let queue = self.compositor.queue().clone();
        let target = Target::new(&device, size, self.compositor.format());
        self.compositor.invalidate();
        self.compositor.render(scene, &target.view, size);
        target.read_rgba(&device, &queue).ok()
    }
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
            messages: Vec::new(),
            attached: HashMap::new(),
            page_damage: Vec::new(),
            popups: HashMap::new(),
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
        let id = composed.texture(&attach.surface);
        let state = &mut *composed;
        let result = state
            .frames
            .attach(&mut state.compositor, id, attach, source);
        let counts = state.attached.entry(attach.surface.clone()).or_default();
        match &result {
            Ok(_) => counts.0 += 1,
            Err(_) => counts.1 += 1,
        }
        if result.is_ok() && attach.surface == super::PAGE {
            // A window that looks no more (the probe's) keeps the last ones only.
            if state.page_damage.len() >= PAGE_PAINTS {
                state.page_damage.remove(0);
            }
            state.page_damage.push(attach.damage.clone());
        }
        state.dirty |= result.is_ok();
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

    fn device(&self) -> (wgpu::Device, wgpu::Queue) {
        let composed = self.lock();
        (
            composed.compositor.device().clone(),
            composed.compositor.queue().clone(),
        )
    }
}
