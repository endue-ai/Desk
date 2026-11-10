//! The spread (ADR 0116): every window on the desktop fanned out in depth over the desk, to pick
//! one. It moves nothing on the desk: each window is drawn at a pose, so the layout, the cover test
//! and the live budget see the windows where they are. `run` moves it between poses on the
//! caller's clock; the compositor draws it (#54).

pub mod model;
pub mod pose;
pub mod run;
pub mod slots;
pub mod windows;
