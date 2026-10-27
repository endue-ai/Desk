//! Brain client types generated from `specs/brain` (the brain trait arrives with the first client).
pub const NAME: &str = env!("CARGO_PKG_NAME");

mod generated;
pub use generated::*;
