//! Prompting through events: a perm.request becomes one `perm.prompt` addressed to every caller
//! holding perm:manage, and the first perm.answer decides. The requester's thread waits on a channel
//! of its own, with no core lock held and no timeout, so hosts call `Core::handle` off their UI
//! thread. A prompt goes out only when a router reads addressed events (`subscribe_addressed`):
//! without one no holder could hear it, so the `Prompter` decides, as it does with no holder.

use std::collections::BTreeMap;
use std::sync::MutexGuard;
use std::sync::mpsc::{self, Sender};

use desk_bridge::{
    BridgeEvent, ErrorCode, Grant, GrantDuration, PermAnswerParams, PermAnswerResult,
    PermPromptData, PermPromptEvent, Permission,
};

use crate::core_perm::perm_manage;
use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;

/// How a prompt ended.
pub(crate) enum Outcome {
    Granted(Grant),
    Refused,
    /// The requester unloaded first.
    Withdrawn,
    /// No perm:manage holder can hear it: the Prompter decides.
    Unheard,
}

struct Waiting {
    caller: String,
    permission: Permission,
    duration: GrantDuration,
    reply: Sender<Outcome>,
}

/// The prompts waiting for an answer, by id.
#[derive(Default)]
pub(crate) struct Prompts {
    next: u64,
    waiting: BTreeMap<String, Waiting>,
}

impl Core {
    /// Prompt the perm:manage holders and wait for the first answer.
    pub(crate) fn prompt(
        &self,
        caller: &str,
        permission: &Permission,
        reason: &str,
        duration: GrantDuration,
    ) -> Outcome {
        let answered = {
            let mut prompts = self.prompts();
            let holders = self.holders(&perm_manage());
            if holders.is_empty() || !self.events().has_router() {
                return Outcome::Unheard;
            }
            prompts.next += 1;
            let prompt_id = format!("p-{}", prompts.next);
            let (reply, answered) = mpsc::channel();
            prompts.waiting.insert(
                prompt_id.clone(),
                Waiting {
                    caller: caller.to_owned(),
                    permission: permission.clone(),
                    duration,
                    reply,
                },
            );
            let event = BridgeEvent::PermPrompt(PermPromptEvent {
                event: Default::default(),
                data: PermPromptData {
                    prompt_id: prompt_id.clone(),
                    caller: caller.to_owned(),
                    permission: permission.clone(),
                    reason: reason.to_owned(),
                    duration,
                },
            });
            if self.events().route(holders, event) == 0 {
                prompts.waiting.remove(&prompt_id);
                return Outcome::Unheard;
            }
            answered
        };
        answered.recv().unwrap_or(Outcome::Withdrawn)
    }

    /// The person's decision, from a perm:manage holder. The grant is made before this returns.
    pub(crate) fn perm_answer(&self, caller: &str, params: PermAnswerParams) -> Answer {
        self.check(caller, &Permission::PermManage(params.scope), &Target::None)?;
        let waiting = self
            .prompts()
            .waiting
            .remove(&params.prompt_id)
            .ok_or_else(|| {
                error(
                    ErrorCode::NotFound,
                    format!("no prompt {} is waiting", params.prompt_id),
                )
            })?;
        let outcome = if params.granted {
            let duration = params.duration.unwrap_or(waiting.duration);
            Outcome::Granted(self.grant_for(&waiting.caller, waiting.permission, duration))
        } else {
            Outcome::Refused
        };
        let _ = waiting.reply.send(outcome);
        json(PermAnswerResult {})
    }

    /// `caller` unloaded: its waiting requests end `cancelled` and their prompts are gone.
    pub(crate) fn withdraw_prompts(&self, caller: &str) {
        self.prompts().waiting.retain(|_, waiting| {
            if waiting.caller != caller {
                return true;
            }
            let _ = waiting.reply.send(Outcome::Withdrawn);
            false
        });
    }

    /// With no perm:manage holder left, the Prompter decides every waiting prompt, so no call hangs.
    pub(crate) fn settle_unheard(&self) {
        let mut prompts = self.prompts();
        if prompts.waiting.is_empty() || !self.holders(&perm_manage()).is_empty() {
            return;
        }
        for (_, waiting) in std::mem::take(&mut prompts.waiting) {
            let _ = waiting.reply.send(Outcome::Unheard);
        }
    }

    fn prompts(&self) -> MutexGuard<'_, Prompts> {
        self.prompts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
