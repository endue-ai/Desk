//! The window commands that take a window out of the canvas and back (#235, ADR 0205): pop out,
//! dock, and the OS window's frame as the shell reports it. Each publishes the desk when it changed
//! something; a pop out or a dock also redraws. A window out of the canvas is on no desktop's
//! canvas, so these look for it on every desktop, unlike the other commands.

use crate::types::Rect;

use super::ops::Op;
use super::wm::{Out, Wm};

impl Wm {
    /// Run `op` if it is one of these on window `window` (the one in use when `None`): what it
    /// calls for, or `None` for the other commands.
    pub(super) fn run_out(&mut self, op: &Op, window: Option<&str>) -> Option<Vec<Out>> {
        let id = window
            .map(str::to_owned)
            .or_else(|| self.drawn.focused.clone());
        let changed = match (op, id.as_deref()) {
            (Op::PopOut { frame }, Some(id)) => {
                let Some(p) = self.drawn.window(id) else {
                    return Some(Vec::new());
                };
                let frame = frame.unwrap_or(Rect::new(0.0, 0.0, p.w, p.h));
                self.glides.remove(id);
                self.drawn.pop_out(id, frame)
            }
            (Op::Dock, Some(id)) => self.drawn.dock(id),
            (Op::OutFrame { frame }, Some(id)) => {
                let same = (self.drawn.out_window(id)).is_some_and(|(_, p)| p.out == Some(*frame));
                !same && self.drawn.set_out_frame(id, *frame)
            }
            (Op::PopOut { .. } | Op::Dock | Op::OutFrame { .. }, None) => false,
            _ => return None,
        };
        if !changed {
            return Some(Vec::new());
        }
        let mut out = vec![self.publish(None)];
        if !matches!(op, Op::OutFrame { .. }) {
            out.push(Out::Redraw);
        }
        Some(out)
    }
}
