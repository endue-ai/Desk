//! desk-update: the decisions of Desk's updater (ADR 0054), apart from Tauri. A desk reads its
//! channel's signed index from the release origin (Cloudflare R2), chooses the next build itself
//! (`policy`), downloads and verifies it at once (`verify`), keeps it on disk (`stage`) and installs
//! it only when asked. The app supplies the `Transport` and the `Installer`; the core serves the
//! `Updater`'s status as `update.*`.
pub const NAME: &str = env!("CARGO_PKG_NAME");

pub mod manifest;
pub mod policy;
mod ports;
pub mod schedule;
pub mod stage;
mod status;
mod time;
mod updater;
pub mod verify;

pub use ports::{Config, Installer, Prefs, Transport};
pub use status::{Channel, Chosen, State, Status};
pub use time::rfc3339;
pub use updater::Updater;
