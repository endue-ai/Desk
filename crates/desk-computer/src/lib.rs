//! Computer use: see and operate every application on this computer, and report and request the OS
//! permissions that takes.
//!
//! - `Computer` is the platform: permissions (TCC), displays, windows, screenshots, the
//!   accessibility tree (read, find, perform, set), synthesized input and apps. `os()` is macOS
//!   (Accessibility, CGEvent, ScreenCaptureKit, NSWorkspace); elsewhere every call answers
//!   `unsupported`. `fake::FakeComputer` records calls and returns scripted screens and trees.
//! - `Control` is the only way to act. Every action passes a caller-supplied `Guard` first (the
//!   core's approval flow, ADR 0078), then the `StopFlag` and the input `RateLimit`, one action at
//!   a time. A `Computer`'s acting methods take a `Permit`, which only `Control` can make.
//! - The pure parts (the AX walk and its `Budget`, the element finder, Unicode chunking for
//!   CGEvent, key chords) live in their own modules and are tested on every OS.
//!
//! Who may call what is decided above this crate; here nothing checks a Desk grant. Calls return
//! desk-sys's `Error { code, message }` with the bridge's codes: `permission_denied` when the OS
//! permission is missing or the guard refused, `cancelled` when the stop flag ended an action.
//! Coordinates are global points with the origin at the top left of the main display.
pub const NAME: &str = env!("CARGO_PKG_NAME");

pub use desk_sys::{Error, ErrorCode};

pub mod apps;
pub mod ax;
mod computer;
mod control;
pub mod fake;
mod geometry;
pub mod input;
pub mod keys;
#[cfg(target_os = "macos")]
mod macos;
mod pace;
pub mod permissions;
pub mod screen;
#[cfg(not(target_os = "macos"))]
mod unsupported;

pub use computer::{Computer, Focus, Permit, os};
pub use control::{Action, Control, Done, Guard, Verdict};
pub use geometry::{Point, Rect};
pub use pace::{Clock, RateLimit, StopFlag, SystemClock};

pub(crate) fn invalid(message: impl Into<String>) -> Error {
    Error::new(ErrorCode::InvalidParams, message)
}

pub(crate) fn not_found(message: impl Into<String>) -> Error {
    Error::new(ErrorCode::NotFound, message)
}
