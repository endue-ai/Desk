//! Primitives: fs (notify), proc (portable-pty), net, calendar (EventKit) and audio (cpal, wake word), each
//! behind a cargo feature.
//! No permission checks happen here: desk-core authorizes every call first.
pub const NAME: &str = env!("CARGO_PKG_NAME");

mod error;
pub use error::{Error, ErrorCode};

#[cfg(feature = "calendar")]
pub mod calendar;
#[cfg(feature = "fs")]
pub mod fs;
#[cfg(feature = "net")]
pub mod net;
#[cfg(feature = "proc")]
pub mod proc;
