//! desk-update: the decisions of Desk's updater (ADR 0054), apart from Tauri. A desk reads its
//! channel's signed upgrade paths from GitHub Releases, chooses the next build itself
//! (`policy`), downloads and verifies it at once (`verify`), keeps it on disk (`stage`) and installs
//! it only when asked. The app supplies the `Transport` and the `Installer`; the core serves the
//! `Updater`'s status as `update.*`.
pub const NAME: &str = env!("CARGO_PKG_NAME");

pub(crate) const LEGACY_RELEASES: &str = "https://github.com/endue-ai/Desk/releases";
pub(crate) const RENAMED_RELEASES: &str = "https://github.com/endue-ai/endue/releases";
/// New installations discover releases at the canonical repository.
pub const GITHUB_RELEASES: &str = RENAMED_RELEASES;

pub mod generated;
#[cfg(feature = "https")]
pub mod https;
#[cfg(feature = "install")]
pub mod install;
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
