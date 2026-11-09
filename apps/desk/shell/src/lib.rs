//! The endue Desk shell on winit and CEF (ADR 0143, Stage 1 of #32): a window with a CEF browser,
//! the desk's URL schemes and CEF's message pump. The core, the bridge and the shell's services
//! arrive with #42–#45; until then the window shows the shell's built-in page.

pub mod app;
pub mod client;
#[cfg(target_os = "macos")]
pub mod mac;
pub mod paths;
pub mod pump;
pub mod scheme;
pub mod window;
