//! The endue Desk shell on winit and CEF (ADR 0143, Stage 1 of #32): a window with a CEF browser,
//! the desk's URL schemes, CEF's message pump, the desk booted through desk-boot and the bridge over
//! CEF's process messages (#43). The plugin scheme and the shell's services arrive with #42, #45.

pub mod app;
pub mod client;
pub mod host;
#[cfg(target_os = "macos")]
pub mod mac;
pub mod paths;
pub mod pump;
pub mod renderer;
pub mod scheme;
pub mod window;
