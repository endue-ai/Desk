//! A native plugin's transport (`specs/surface/v0/native.md`, #59, ADR 0154), for both sides: the
//! desk's native host and the plugin's own process. Each message is one JSON line on the surface
//! connection (`lines`); on macOS the Mach send right of an IOSurface travels in a Mach message to
//! the desk's port just before the line that names it (`mach`). The plugin's side is `plugin`: it
//! connects from its environment, hears the desk's messages (answering its pings by itself), and
//! sends frames, its title and page messages; `bridge` calls the bridge on the other connection.
//! `iosurface` (feature `native-wgpu`, macOS) is a frame a plugin renders into with wgpu.

pub mod lines;

#[cfg(target_os = "macos")]
pub mod mach;

#[cfg(unix)]
pub mod bridge;
#[cfg(unix)]
pub mod plugin;

#[cfg(all(target_os = "macos", feature = "native-wgpu"))]
pub mod iosurface;
