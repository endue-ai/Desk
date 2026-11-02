//! A brain.say turn's sink (conversation.rs): the brain's stream events as brain.turn events, the
//! answer so far, and the tool call the turn waits on.

use std::mem;

use desk_brain::{StopReason, ToolCall, TurnEvent};
use desk_bridge::{BrainTurnData, BrainTurnEvent, BrainTurnKind, BridgeEvent};

use crate::events::EventBus;

/// Turns brain stream events into brain.turn events for one turn.
pub(crate) struct Sink<'a> {
    events: &'a EventBus,
    pub(crate) turn: &'a str,
    pub(crate) offline: bool,
    pub(crate) pending: Option<(String, ToolCall)>,
    pub(crate) answer: String,
    pub(crate) completed: bool,
    pub(crate) failed: bool,
}

impl<'a> Sink<'a> {
    pub(crate) fn new(events: &'a EventBus, turn: &'a str) -> Self {
        Self {
            events,
            turn,
            offline: false,
            pending: None,
            answer: String::new(),
            completed: false,
            failed: false,
        }
    }

    pub(crate) fn publish(&self, kind: BrainTurnKind, text: Option<&str>) {
        self.events.publish(BridgeEvent::BrainTurn(BrainTurnEvent {
            event: Default::default(),
            data: BrainTurnData {
                turn_id: self.turn.to_owned(),
                kind,
                text: text.map(str::to_owned),
                structured: None,
            },
        }));
    }

    /// The brain answered: a turn that was waiting offline is back online.
    pub(crate) fn reached(&mut self) {
        if mem::take(&mut self.offline) {
            self.publish(BrainTurnKind::Online, None);
        }
    }

    pub(crate) fn on(&mut self, event: TurnEvent) {
        self.reached();
        match event {
            TurnEvent::TurnStarted(_) => {
                self.answer.clear();
                self.publish(BrainTurnKind::Started, None);
            }
            TurnEvent::TextDelta(delta) => {
                self.answer.push_str(&delta.text);
                self.publish(BrainTurnKind::Delta, Some(&delta.text));
            }
            TurnEvent::ToolCall(call) => self.pending = Some((call.turn_id, call.call)),
            TurnEvent::TurnCompleted(done) if done.stop_reason == StopReason::ToolCall => {}
            TurnEvent::TurnCompleted(_) => {
                self.completed = true;
                self.publish(BrainTurnKind::Completed, None);
            }
            TurnEvent::TurnError(_) => self.failed = true,
        }
    }
}
