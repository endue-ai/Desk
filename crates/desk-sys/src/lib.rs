//! Primitives: fs (notify), proc (portable-pty), net, shell (links and files handed to the system),
//! calendar (EventKit), notification (UserNotifications, toasts, freedesktop), login (start at
//! login), clipboard (text, NSPasteboard and user32) and audio (cpal, wake word), each behind a cargo
//! feature.
//! No permission checks happen here: desk-core authorizes every call first.
pub const NAME: &str = env!("CARGO_PKG_NAME");

mod error;
pub use error::{Error, ErrorCode};

#[cfg(feature = "audio")]
pub mod audio;
#[cfg(feature = "calendar")]
pub mod calendar;
#[cfg(feature = "clipboard")]
pub mod clipboard;
#[cfg(feature = "fs")]
pub mod fs;
#[cfg(feature = "login")]
pub mod login;
#[cfg(feature = "net")]
pub mod net;
#[cfg(feature = "notification")]
pub mod notification;
#[cfg(feature = "proc")]
pub mod proc;

pub mod search;
#[cfg(feature = "shell")]
pub mod shell;
