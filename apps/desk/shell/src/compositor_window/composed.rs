//! The compositor's side of the surface protocol in the desk's process: the frames surfaces attach
//! (`desk_compositor::Frames`, the texture import entry) and the other messages they send, behind
//! the `SurfaceSink` the web host talks to. Shared by the compositor window and the surface probe.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use desk_compositor::headless::Target;
use desk_compositor::{AttachError, Attached, Compositor, Frames, Scene, Source, TextureId};
use desk_surface::generated::{SurfaceAttach, SurfaceMessage};

use crate::web_host::SurfaceSink;

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

    /// `surface` is gone: its frames go too.
    pub fn destroy(&mut self, surface: &str) {
        if let Some(id) = self.textures.remove(surface) {
            self.frames.destroy(&mut self.compositor, id);
            self.dirty = true;
        }
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
        composed.messages.push(message);
    }

    fn device(&self) -> (wgpu::Device, wgpu::Queue) {
        let composed = self.lock();
        (
            composed.compositor.device().clone(),
            composed.compositor.queue().clone(),
        )
    }
}
