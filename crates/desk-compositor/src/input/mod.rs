//! Input (#56, #32 §3): the compositor hears every input event of its OS window first and routes it
//! to the surface it is for, in that surface's own logical pixels (`specs/surface/v0/input.md`,
//! `ime.md`). Nothing here knows winit or CEF: the shell turns the window's events into [`Input`]s
//! and feeds them to one [`InputRouter`], which answers with [`Out`]s: surface protocol messages,
//! the cursor, the OS input method's state, keys the desk's keymap takes, files nobody took.
//!
//! - `targets`: which surface a scene node shows, and how its units map to the surface's pixels.
//! - `pointer`: hit test, capture while a press is held, leave, clicks.
//! - `keys` and `keymap`: the shell keymap (ADR 0118) decides first; the rest goes to the focus.
//! - `follow`: the focus follows the window in use where the page's own focus rests on nothing.
//! - `ime`: compositions and commits for the focused surface; its caret for the candidate window.
//! - `cursor`: the cursor of the surface the pointer is for, or of a drag.
//! - `dnd`: ADR 0119's broker, between surfaces and from the OS.

pub mod cursor;
pub mod dnd;
pub mod events;
mod focus;
pub mod follow;
pub mod ime;
pub mod keymap;
mod keys;
pub mod messages;
pub mod pointer;
pub mod router;
mod said;
pub mod targets;

pub use cursor::CursorChoice;
pub use dnd::DragOverlay;
pub use events::{Button, ImeInput, Input, KeyInput, Modifiers};
pub use follow::PageFocus;
pub use pointer::PointerSettings;
pub use router::{InputRouter, Out};
pub use targets::{Area, Target, Targets, Under};
