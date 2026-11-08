//! A brain.say turn's completed event, held back (conversation.rs). The brain's stream reaches
//! the turn's sink as it comes, except that a turn the brain ends in words says completed only
//! once the episode Eris keeps of it is in memory (ADR 0096, #575), so whoever reads memory.list
//! on completed finds it.

use std::mem;

use desk_brain::{StopReason, TurnEvent};
use desk_bridge::BrainTurnKind;

use crate::conversation_sink::Sink;

/// Whether the brain ended the turn in words and the desk has not said so yet.
#[derive(Default)]
pub(super) struct Held(bool);

impl Held {
    /// Hand `event` to `sink`, holding back the completed of a turn that ends in words.
    pub(super) fn on(&mut self, sink: &mut Sink<'_>, event: TurnEvent) {
        match event {
            TurnEvent::TurnCompleted(done) if done.stop_reason != StopReason::ToolCall => {
                sink.reached();
                sink.completed = true;
                self.0 = true;
            }
            event => sink.on(event),
        }
    }

    /// Say the held completed, if there is one.
    pub(super) fn release(&mut self, sink: &Sink<'_>) {
        if mem::take(&mut self.0) {
            sink.publish(BrainTurnKind::Completed, None);
        }
    }
}
