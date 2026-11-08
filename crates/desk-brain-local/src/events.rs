//! The turn events of `specs/brain/v0`, built for one turn.

use desk_brain::{
    StopReason, TextDeltaEvent, ToolCall, ToolCallEvent, TurnCompletedEvent, TurnEvent,
    TurnStartedEvent,
};

pub fn started(turn_id: &str) -> TurnEvent {
    TurnEvent::TurnStarted(TurnStartedEvent {
        r#type: Default::default(),
        turn_id: turn_id.to_owned(),
    })
}

pub fn delta(turn_id: &str, text: &str) -> TurnEvent {
    TurnEvent::TextDelta(TextDeltaEvent {
        r#type: Default::default(),
        turn_id: turn_id.to_owned(),
        text: text.to_owned(),
    })
}

pub fn tool_call(turn_id: &str, call: ToolCall) -> TurnEvent {
    TurnEvent::ToolCall(ToolCallEvent {
        r#type: Default::default(),
        turn_id: turn_id.to_owned(),
        call,
    })
}

pub fn completed(turn_id: &str, stop_reason: StopReason) -> TurnEvent {
    TurnEvent::TurnCompleted(TurnCompletedEvent {
        r#type: Default::default(),
        turn_id: turn_id.to_owned(),
        stop_reason,
    })
}
