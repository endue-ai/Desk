//! The runtime's edits on the window manager (#83, `edits.rs`): a batch the runtime numbered is
//! applied in order to the desk, and the desk is published whole once, with the answers. A gesture
//! whose window an edit took away is cancelled, and what waited for a window an edit brought runs.

use serde_json::Value;

use crate::edits::{Edit, apply};

use super::publish::Answered;
use super::wm::{Out, Wm};

impl Wm {
    /// Apply the runtime's batch `seq` of `edits`; what that calls for.
    pub fn edit(&mut self, seq: u64, edits: &[Edit]) -> Vec<Out> {
        let screen = self.screen;
        let values = edits
            .iter()
            .map(|edit| apply(&mut self.drawn, &mut self.kept, edit, screen))
            .collect();
        self.edited(seq, values)
    }

    /// The same from the batch as the page sent it: an edit that does not read as one changes
    /// nothing and answers null, and the rest still apply, so the runtime hears the batch settle.
    pub fn edit_json(&mut self, seq: u64, edits: &[Value]) -> Vec<Out> {
        let screen = self.screen;
        let values = edits
            .iter()
            .map(
                |value| match serde_json::from_value::<Edit>(value.clone()) {
                    Ok(edit) => apply(&mut self.drawn, &mut self.kept, &edit, screen),
                    Err(_) => Value::Null,
                },
            )
            .collect();
        self.edited(seq, values)
    }

    fn edited(&mut self, seq: u64, values: Vec<Value>) -> Vec<Out> {
        let mut out = Vec::new();
        let gone = (self.gesture.as_ref())
            .and_then(|g| g.window_id().map(str::to_owned))
            .is_some_and(|id| self.drawn.window(&id).is_none());
        if gone {
            out.extend(self.cancel_gesture());
        }
        out.push(self.publish(Some(Answered { seq, values })));
        out.extend(self.retry());
        out.push(Out::Redraw);
        out
    }
}
