//! Where a web surface's messages go (`SurfaceSink`): the compositor, in this process. The
//! compositor sees only the surface protocol, never CEF.

use desk_compositor::{AttachError, Attached, Source};
use desk_surface::generated::{SurfaceAttach, SurfaceMessage};

use super::render::popup::Place;

/// Where a web surface's messages go: the compositor, in this process.
pub trait SurfaceSink: Send + Sync {
    /// A frame, inside the engine's paint callback: done with `source` when this returns.
    fn attach(&self, attach: &SurfaceAttach, source: Source<'_>) -> Result<Attached, AttachError>;
    /// Every other message: `ready`, `died`, `title`.
    fn message(&self, message: SurfaceMessage);
    /// Its popup widget is at `place` in its view, or closed (`render::popup`, #156).
    fn popup(&self, surface: &str, place: Option<Place>);
    /// A page's hover title now (`""`: none), for the compositor to draw (#156, `routes.rs`).
    fn tooltip(&self, surface: &str, text: &str);
    /// The compositor's device, for frames the engine imports or the host uploads itself.
    fn device(&self) -> (wgpu::Device, wgpu::Queue);
}
