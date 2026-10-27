//! Rust side of the Desk bridge: the types generated from `specs/bridge` and `specs/plugin`.
pub const NAME: &str = env!("CARGO_PKG_NAME");

mod generated;
pub use generated::*;
