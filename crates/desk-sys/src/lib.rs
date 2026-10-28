//! Primitives: fs (notify), proc (portable-pty), net and audio (cpal, wake word), each behind a cargo feature.
pub const NAME: &str = env!("CARGO_PKG_NAME");

#[cfg(feature = "audio")]
pub mod audio;
#[cfg(feature = "fs")]
pub mod fs;
#[cfg(feature = "net")]
pub mod net;
#[cfg(feature = "proc")]
pub mod proc;
