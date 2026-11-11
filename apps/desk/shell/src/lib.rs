//! The endue Desk shell on winit and CEF (ADR 0143, Stage 1 of #32): windows holding CEF browsers,
//! the desk's URL schemes, CEF's message pump, the desk booted through desk-boot, the bridge over
//! CEF's process messages (#43), the plugin scheme (#42) and the shell's services (#45): the tray,
//! the menus, global shortcuts, the file dialog, one desk per data folder, files opened with the
//! desk, the palette, the floating Eris and the computer-use banner; and its own updates (#47).

pub mod app;
pub mod client;
pub mod commands;
pub mod compositor_window;
pub mod computer;
pub mod crashes;
pub mod dialog;
pub mod displays;
pub mod drops;
pub mod eris_window;
pub mod features;
pub mod float;
pub mod guard;
pub mod host;
pub mod hotkeys;
pub mod instance;
#[cfg(target_os = "macos")]
pub mod mac;
pub mod menu;
#[cfg(unix)]
pub mod native_host;
#[cfg(not(unix))]
#[path = "native_host/unsupported.rs"]
pub mod native_host;
pub mod open_files;
pub mod palette;
pub mod palette_assets;
pub mod pane;
pub mod paths;
pub mod plugin_scheme;
pub mod probe;
pub mod process_start;
pub mod pump;
pub mod quit;
pub mod release;
pub mod renderer;
pub mod run_event;
pub mod sandbox;
pub mod scheme;
pub mod tray;
pub mod update;
pub mod web_host;
pub mod window;
