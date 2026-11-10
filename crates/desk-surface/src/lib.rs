//! desk-surface: the surface protocol (`specs/surface/v0`) as Rust types. A surface is a texture a
//! process rendered and the compositor places: a web surface's host speaks it today, a native
//! plugin's process in Stage 3. The compositor sends `CompositorMessage`s (lifecycle, releases,
//! pace, input, IME, drag and drop, accessibility requests); a surface sends `SurfaceMessage`s
//! (ready, died, title, frames, rate, cursor, IME state, drags, accessibility tree). Each message is
//! one JSON object; file descriptors and Mach rights travel beside it, named by index.
pub const NAME: &str = env!("CARGO_PKG_NAME");

pub mod env;
pub mod generated;
#[cfg(feature = "native")]
pub mod native;

pub use generated::{CompositorMessage, SurfaceMessage};
