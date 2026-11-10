//! One press's lifecycle (`draggable` in `packages/runtime/src/shell/drag.ts`): a press holds the
//! pointer at once, so crossing a plugin's surface never loses the drag; it becomes a drag only once
//! the pointer has gone more than 8 px from where it was pressed, so a click stays a click; and it
//! ends with the release, or is cancelled (Escape, the app losing the focus, the pointer taken away,
//! the window gone) without committing anything. After it ends nothing it hears counts.

use serde::{Deserialize, Serialize};

use crate::types::Point;

/// How far, in pixels, the pointer moves from the press before a press is a drag.
pub const DRAG_THRESHOLD: f64 = 8.0;

/// Where a press is in its life.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    /// Pressed, not moved past the threshold yet.
    Pressed,
    Dragging,
    /// Released, or cancelled: it hears nothing more.
    Over,
}

/// What a pointer move did to a press.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Step {
    /// Still a press, or over.
    Nothing,
    /// It just became a drag; the move is `dx`, `dy` from the press.
    Started { dx: f64, dy: f64 },
    /// A drag moved to `dx`, `dy` from the press.
    Moved { dx: f64, dy: f64 },
}

/// A press of the primary button.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Drag {
    pub from: Point,
    phase: Phase,
}

impl Drag {
    /// A press at `from`.
    pub fn new(from: Point) -> Drag {
        Drag {
            from,
            phase: Phase::Pressed,
        }
    }

    pub fn phase(&self) -> Phase {
        self.phase
    }

    pub fn dragging(&self) -> bool {
        self.phase == Phase::Dragging
    }

    /// The pointer moved to `at`.
    pub fn moved(&mut self, at: Point) -> Step {
        let (dx, dy) = (at.x - self.from.x, at.y - self.from.y);
        match self.phase {
            Phase::Over => Step::Nothing,
            Phase::Pressed if dx.hypot(dy) <= DRAG_THRESHOLD => Step::Nothing,
            Phase::Pressed => {
                self.phase = Phase::Dragging;
                Step::Started { dx, dy }
            }
            Phase::Dragging => Step::Moved { dx, dy },
        }
    }

    /// The button went up at `at`: the drop, `dx`, `dy` from the press, when it was a drag.
    pub fn released(&mut self, at: Point) -> Option<(f64, f64)> {
        let was = self.phase;
        self.phase = Phase::Over;
        (was == Phase::Dragging).then_some((at.x - self.from.x, at.y - self.from.y))
    }

    /// Escape, the app losing the focus, the pointer taken away: whether a drag was cancelled (a
    /// press below the threshold just ends).
    pub fn cancel(&mut self) -> bool {
        let was = self.phase;
        self.phase = Phase::Over;
        was == Phase::Dragging
    }
}
