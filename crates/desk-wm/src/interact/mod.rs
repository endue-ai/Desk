//! Interactions on the compositor's input (#80, ADR 0153), ported from the runtime's
//! `surface/interactions.ts`, `surface/resize.ts`, `shell/drag.ts` and `shell/Pan.ts` with the same
//! numbers: the 8 px drag threshold, the eight grips, 24 px snap zones (8 at the top), the snap
//! preview and the glide into a part over `--motion-base`.
//!
//! - `drag`: one press's lifecycle, from the press to a drag past the threshold, to the drop or a
//!   cancel.
//! - `resize`: the grips, where they lie in a window and how a rect grows from each.
//! - `gesture`: moving by the title bar (snapping at the edges and corners, coming off a fill),
//!   resizing from a grip, Shift + drag panning the canvas.
//! - `motion`: the desk's easing, a rect gliding, the snap preview growing and gliding.
//! - `mid_glide`: a press on a window mid-glide, found where the window is drawn (#124).
//! - `wm`, `pointer`, `ops`: [`Wm`], the window manager the compositor drives: the runtime's desk
//!   with what it changed since, the compositor's pointer and keys, the `desk.display.*` window
//!   commands, and each frame's places.
//! - `publish`: the whole desk the runtime takes on each change; `edit`: the runtime's edits (#83).
//! - `cursor`: the cursor over the grips and title bars and while a gesture runs (#159).

pub mod cursor;
pub mod drag;
pub mod edit;
pub mod gesture;
mod mid_glide;
pub mod motion;
pub mod ops;
mod out;
pub mod pointer;
pub mod publish;
pub mod resize;
pub mod wm;

pub use drag::{DRAG_THRESHOLD, Drag, Phase, Step};
pub use gesture::{Done, Gesture, Kind, Live};
pub use motion::{Easing, Glide, Motion, Preview, duration_ms, mix_rect};
pub use ops::Op;
pub use pointer::PressLog;
pub use publish::{Answered, Change, Geometry, Published};
pub use resize::{GRIPS, Grip, grip_at, resize_rect, resize_rect_min};
pub use wm::{Frame, Out, Wm};
