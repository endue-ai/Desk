//! A Studio run for the shell, whose irreversible command carries the exact agent and question.
//! Recheck the space and its server-bound Front Desk before a turn can leave the desk.

use desk_bridge::{ErrorCode, StudioChatAskParams, StudioChatAskResult, StudioChatState};
use desk_platform::{ChatState, ChatTurn, ErrorKind, wire::AgentStatus};

use super::spaces::id_of;
use crate::core_studio::{failed, invalid, words};
use crate::handler::{Answer, Core, error, json};

fn message_id() -> Result<String, desk_bridge::BridgeError> {
    use std::fmt::Write;

    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| {
        error(
            ErrorCode::IoError,
            "Could not assign a message identifier.".to_owned(),
        )
    })?;
    let mut id = String::from("desk_");
    for byte in bytes {
        let _ = write!(id, "{byte:02x}");
    }
    Ok(id)
}

impl Core {
    pub(crate) fn studio_chat_ask(&self, caller: &str, params: StudioChatAskParams) -> Answer {
        if caller != "desk" {
            return Err(error(
                ErrorCode::PermissionDenied,
                "Send agent questions through the desk's reviewed command.".to_owned(),
            ));
        }
        let agent_id = id_of(&params.agent_id).ok_or_else(|| invalid("Choose an agent ID."))?;
        let space_id = params
            .space_id
            .as_deref()
            .map(|id| id_of(id).ok_or_else(|| invalid("Choose a space ID.")))
            .transpose()?;
        let question = words(&params.question, "question", 8000)?;
        let platform = self.platform_for(caller, params.scope)?;
        let message = message_id()?;
        let conversation = match space_id.as_deref() {
            Some(id) => {
                let space = platform.space(id).map_err(failed)?;
                if space.id != id
                    || space.status.as_deref() != Some("active")
                    || space.front_agent_id.as_deref() != Some(agent_id.as_str())
                {
                    return Err(invalid(
                        "The space or its Front Desk changed. Read the space again.",
                    ));
                }
                platform.space_conversation(id)
            }
            None => {
                let agent = platform.get_agent(&agent_id).map_err(failed)?;
                if agent.id != agent_id || agent.status != AgentStatus::Active {
                    return Err(invalid("Choose an active endue AI agent."));
                }
                platform.agent_conversation(&agent_id)
            }
        }
        .map_err(failed)?;
        if conversation.agent_id != agent_id {
            return Err(invalid("This conversation belongs to another agent."));
        }
        let conversation_id = id_of(&conversation.id)
            .ok_or_else(|| invalid("endue AI returned an invalid conversation identifier."))?;
        let turn = match platform.chat_turn(&conversation, &question, &message) {
            Ok(turn) => turn,
            Err(e) if e.kind == ErrorKind::Offline => ChatTurn::interrupted(),
            Err(e) => return Err(failed(e)),
        };
        let state = match turn.state {
            ChatState::Done => StudioChatState::Done,
            ChatState::NeedsInput => StudioChatState::NeedsInput,
            ChatState::Interrupted => StudioChatState::Interrupted,
            ChatState::Failed => StudioChatState::Failed,
        };
        json(StudioChatAskResult {
            agent_id,
            space_id,
            conversation_id,
            run_id: turn.run_id,
            state,
            text: turn.text,
        })
    }
}
