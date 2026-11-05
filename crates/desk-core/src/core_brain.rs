//! The brain side of `Core`: brain.say, and opening a session on this desk. A desk has one brain
//! (`with_brain`) or chooses among several (`with_brains`, brain_choice.rs, ADR 0094).

use std::sync::Arc;

use desk_brain::Brain;
use desk_bridge::{BrainSayParams, BrainSayResult, ErrorCode, Permission};

use crate::conversation::{BrainOptions, Conversation};
use crate::handler::{Answer, Core, error, json};
use crate::lease::LeaseError;
use crate::perm::Target;

impl Core {
    /// Answer brain.say with `brain`. The session store lives in `options.state_file`.
    pub fn with_brain(mut self, brain: Arc<dyn Brain>, options: BrainOptions) -> Self {
        if let Some(path) = &options.state_file {
            self.screen_state(path, crate::sessions::readable);
        }
        self.conversation = Some(Conversation::new(brain, self.events().clone(), options));
        self
    }

    /// Continue `session_id` on this desk, taking its lease over from any other desk. The desk that
    /// held it becomes read-only.
    pub fn open_session(&self, session_id: &str) -> Result<(), LeaseError> {
        self.talking()
            .ok_or(LeaseError::NoSession)?
            .conversation
            .open(session_id)
    }

    /// The brain session this desk continues, once it has one.
    pub fn brain_session(&self) -> Option<String> {
        self.talking()?.conversation.session_id()
    }

    pub(crate) fn brain_say(&self, caller: &str, params: BrainSayParams) -> Answer {
        self.check(
            caller,
            &Permission::BrainConverse(params.scope),
            &Target::None,
        )?;
        let picked = self.talking().ok_or_else(|| {
            error(
                ErrorCode::Unsupported,
                "no brain is configured for this desk".to_owned(),
            )
        })?;
        let text = params.text.trim();
        if text.is_empty() {
            return Err(error(
                ErrorCode::InvalidParams,
                "brain.say needs some text".to_owned(),
            ));
        }
        json(BrainSayResult {
            turn_id: picked.conversation.say(text, picked.fallback),
        })
    }
}
