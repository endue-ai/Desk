//! Rust side of the Desk bridge: the types generated from `specs/bridge`, `specs/plugin`,
//! `specs/item`, `specs/view`, `specs/connector` and `specs/init`, and the rules of views and
//! manifests that the schemas cannot say.
pub const NAME: &str = env!("CARGO_PKG_NAME");

mod generated;
mod names;
pub use generated::*;
pub use names::{manifest_problems, view_problems};
