//! Drag and drop (ADR 0119, `specs/surface/v0/input.md` § Drag and drop): desk data read at the
//! trust boundary (`data.rs`) and the broker that runs one drag at a time between surfaces and from
//! the OS (`broker.rs`), and what crosses the window's edge to and from the OS (`os.rs`).

pub mod broker;
pub mod data;
mod landing;
mod os;

pub use broker::{ANSWER_WAIT, Broker, DndOut, DragOverlay};
pub use data::{DragLook, read_items, taken, type_of};
