//! A brain.say turn's sink (conversation.rs): the brain's stream events as brain.turn events, the
//! answer so far, and the tool call the turn waits on.

use std::mem;

use desk_brain::{StopReason, ToolCall, TurnEvent};
use desk_bridge::{
    BrainTurnData, BrainTurnEvent, BrainTurnKind, BrainTurnTool, BridgeEvent, MemoryStep,
};

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
    /// Said first, once the brain starts its answer (the fallback line, ADR 0094).
    pub(crate) prefix: Option<String>,
    /// The commands the turn's errands ran, for its episode (ADR 0096).
    pub(crate) steps: Vec<MemoryStep>,
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
            prefix: None,
            steps: Vec::new(),
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
                tool: None,
            },
        }));
    }

    /// A tool step: Eris hands work to a command (`Tool`), or its answer went back (`ToolResult`).
    pub(crate) fn step(&mut self, kind: BrainTurnKind, tool: BrainTurnTool) {
        if kind == BrainTurnKind::ToolResult {
            let ok = tool.ok.unwrap_or(true);
            self.steps.push(MemoryStep {
                command: tool.command.clone(),
                ok,
            });
        }
        self.events.publish(BridgeEvent::BrainTurn(BrainTurnEvent {
            event: Default::default(),
            data: BrainTurnData {
                turn_id: self.turn.to_owned(),
                kind,
                text: None,
                structured: None,
                tool: Some(tool),
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
                if let Some(prefix) = self.prefix.take() {
                    let said = format!("{prefix} ");
                    self.answer.push_str(&said);
                    self.publish(BrainTurnKind::Delta, Some(&said));
                }
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
