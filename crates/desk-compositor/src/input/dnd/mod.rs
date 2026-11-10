//! Drag and drop (ADR 0119, `specs/surface/v0/input.md` § Drag and drop): desk data read at the
//! trust boundary (`data.rs`) and the broker that runs one drag at a time between surfaces and from
//! the OS (`broker.rs`).

pub mod broker;
pub mod data;
mod landing;

pub use broker::{ANSWER_WAIT, Broker, DndOut, DragOverlay};
pub use data::{DragLook, read_items, taken, type_of};
