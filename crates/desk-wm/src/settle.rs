//! A window gliding into its part (ADR 0132; `settle` in `packages/runtime/src/surface/
//! interactions.ts`). A window whose fill changes (a snap on the drop, a maximize, a restore, from
//! one part to another) glides there instead of jumping; a filled one dragged away glides its size
//! only, so it never lags the pointer. The glide ends when the size has arrived, or after
//! `SETTLE_MS` when nothing arrives (reduced motion zeroes the motion, or nothing moved).
//!
//! The DOM marked the glide with a class (`is-settling` for `Place`, `is-unsnapping` for `Size`)
//! and heard `transitionend`; here whoever runs the motion reports what arrived and how much time
//! passed (the frame loop's injected clock, ADR 0013), and reads `gliding()`.

use serde::{Deserialize, Serialize};

/// How long a window takes to glide into its part, or out of it, at most: then it stops gliding.
pub const SETTLE_MS: f64 = 400.0;

/// What glides.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SettleKind {
    /// Place and size: a snap, a fill, a restore.
    Place,
    /// The size only: a filled window taking its own size back under the pointer.
    Size,
}

/// One of the window's animated properties arriving.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Glided {
    Left,
    Top,
    Width,
    Height,
}

/// A window's glide, from its start.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Settle {
    kind: SettleKind,
    elapsed: f64,
    done: bool,
}

impl Settle {
    /// A glide starting now.
    pub fn new(kind: SettleKind) -> Self {
        Self {
            kind,
            elapsed: 0.0,
            done: false,
        }
    }

    pub fn kind(&self) -> SettleKind {
        self.kind
    }

    /// Whether the window still glides.
    pub fn gliding(&self) -> bool {
        !self.done
    }

    /// The window's own `property` arrived: its left or top arriving is not the end, its width or
    /// height is.
    pub fn transition_end(&mut self, property: Glided) {
        if matches!(property, Glided::Width | Glided::Height) {
            self.done = true;
        }
    }

    /// `ms` more passed; at `SETTLE_MS` the glide ends whatever arrived.
    pub fn advance(&mut self, ms: f64) {
        self.elapsed += ms;
        if self.elapsed >= SETTLE_MS {
            self.done = true;
        }
    }
}
