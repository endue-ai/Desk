//! Prompting through events: a perm.request becomes one `perm.prompt` addressed to every caller
//! holding perm:manage, and the first perm.answer decides. The requester's thread waits on a channel
//! of its own, with no core lock held and no timeout, so hosts call `Core::handle` off their UI
//! thread. A prompt goes out only when a router reads addressed events (`subscribe_addressed`):
//! without one no holder could hear it, so the `Prompter` decides, as it does with no holder.
//! The prompt policy (`prompt_policy`) runs under the same lock: a request the person refused
//! earlier never prompts, an identical request waits for the prompt already out, and a third folder
//! under one parent offers the parent.

use std::collections::BTreeMap;
use std::sync::MutexGuard;
use std::sync::mpsc::{self, Sender};

use desk_bridge::{
    BridgeEvent, ErrorCode, Grant, GrantDuration, PendingKind, PermAnswerParams, PermAnswerResult,
    PermPromptData, PermPromptEvent, Permission,
};

use crate::core_perm::perm_manage;
use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;
use crate::prompt_policy::Policy;

/// How a prompt ended.
#[derive(Clone)]
pub(crate) enum Outcome {
    Granted(Grant),
    Refused,
    /// The person refused this caller this permission earlier in the session: nobody was asked.
    RefusedEarlier,
    /// The requester unloaded first.
    Withdrawn,
    /// No perm:manage holder can hear it: the Prompter decides.
    Unheard,
}

/// A prompt that is out, as its perm.prompt said it and in the order prompts went out, with every
/// identical request waiting for its answer.
struct Waiting {
    seq: u64,
    data: PermPromptData,
    replies: Vec<Sender<Outcome>>,
}

impl Waiting {
    fn tell(&self, outcome: &Outcome) {
        for reply in &self.replies {
            let _ = reply.send(outcome.clone());
        }
    }
}

/// The prompts waiting for an answer, by id, and the policy's memory.
#[derive(Default)]
pub(crate) struct Prompts {
    next: u64,
    waiting: BTreeMap<String, Waiting>,
    policy: Policy,
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
            if prompts.policy.refused_earlier(caller, permission) {
                return Outcome::RefusedEarlier;
            }
            let holders = self.holders(&perm_manage());
            if holders.is_empty() || !self.events().has_router() {
                return Outcome::Unheard;
            }
            let (reply, answered) = mpsc::channel();
            let same = prompts
                .waiting
                .values_mut()
                .find(|w| w.data.caller == caller && w.data.permission == *permission);
            match same {
                Some(waiting) => waiting.replies.push(reply),
                None => {
                    let offerable = |parent: &str| self.offerable(parent);
                    let parent = prompts
                        .policy
                        .parent_offer(caller, permission, offerable)
                        // Never beyond an agent's allowlist (ADR 0072).
                        .filter(|offer| self.capped(caller, offer).is_none());
                    prompts.next += 1;
                    let prompt_id = format!("p-{}", prompts.next);
                    let data = PermPromptData {
                        prompt_id: prompt_id.clone(),
                        caller: caller.to_owned(),
                        permission: permission.clone(),
                        reason: (!reason.is_empty()).then(|| reason.to_owned()),
                        duration,
                        parent,
                    };
                    let event = BridgeEvent::PermPrompt(PermPromptEvent {
                        event: Default::default(),
                        data: data.clone(),
                    });
                    let waiting = Waiting {
                        seq: prompts.next,
                        data,
                        replies: vec![reply],
                    };
                    prompts.waiting.insert(prompt_id.clone(), waiting);
                    if self.events().route(holders, event) == 0 {
                        prompts.waiting.remove(&prompt_id);
                        return Outcome::Unheard;
                    }
                }
            }
            answered
        };
        answered.recv().unwrap_or(Outcome::Withdrawn)
    }

    /// The person's decision, from a perm:manage holder, for every request waiting on the prompt.
    /// The grants are made before this returns: one for all, or one each for a `once` answer, so
    /// every call the requests were made for can run. A refusal is remembered.
    pub(crate) fn perm_answer(&self, caller: &str, params: PermAnswerParams) -> Answer {
        self.check(caller, &Permission::PermManage(params.scope), &Target::None)?;
        let widen = params.granted && params.parent == Some(true);
        let waiting = {
            let mut prompts = self.prompts();
            let id = params.prompt_id;
            let Some(waiting) = prompts.waiting.remove(&id) else {
                let missing = format!("no prompt {id} is waiting");
                return Err(error(ErrorCode::NotFound, missing));
            };
            if widen && waiting.data.parent.is_none() {
                // The prompt keeps waiting for an answer it can take.
                prompts.waiting.insert(id.clone(), waiting);
                let none = format!("prompt {id} offers no parent");
                return Err(error(ErrorCode::InvalidParams, none));
            }
            if !params.granted {
                prompts
                    .policy
                    .refuse(&waiting.data.caller, &waiting.data.permission);
            }
            waiting
        };
        self.settled(PendingKind::Prompt, &waiting.data.prompt_id);
        if !params.granted {
            waiting.tell(&Outcome::Refused);
            return json(PermAnswerResult {});
        }
        let duration = params.duration.unwrap_or(waiting.data.duration);
        let permission = match (widen, &waiting.data.parent) {
            (true, Some(parent)) => parent.clone(),
            _ => waiting.data.permission.clone(),
        };
        let mut shared: Option<Grant> = None;
        for reply in &waiting.replies {
            let grant = match &shared {
                Some(grant) if duration != GrantDuration::Once => grant.clone(),
                _ => self.grant_for(&waiting.data.caller, permission.clone(), duration),
            };
            shared = Some(grant.clone());
            let _ = reply.send(Outcome::Granted(grant));
        }
        json(PermAnswerResult {})
    }

    /// Whether the person refused `caller` exactly `permission` earlier in the session.
    pub(crate) fn refused_earlier(&self, caller: &str, permission: &Permission) -> bool {
        self.prompts().policy.refused_earlier(caller, permission)
    }

    /// `caller` was granted `permission`: the refusals it covers are forgotten.
    pub(crate) fn forget_refusals(&self, caller: &str, permission: &Permission) {
        self.prompts().policy.granted(caller, permission);
    }

    /// `caller` unloaded: its waiting requests end `cancelled` and their prompts are gone.
    pub(crate) fn withdraw_prompts(&self, caller: &str) {
        let mut gone = Vec::new();
        self.prompts().waiting.retain(|id, waiting| {
            if waiting.data.caller != caller {
                return true;
            }
            waiting.tell(&Outcome::Withdrawn);
            gone.push(id.clone());
            false
        });
        for id in gone {
            self.settled(PendingKind::Prompt, &id);
        }
    }

    /// The prompts waiting for the person, oldest first, as their perm.prompt said them.
    pub(crate) fn waiting_prompts(&self) -> Vec<PermPromptData> {
        let prompts = self.prompts();
        let mut waiting: Vec<&Waiting> = prompts.waiting.values().collect();
        waiting.sort_by_key(|w| w.seq);
        waiting.into_iter().map(|w| w.data.clone()).collect()
    }

    /// With no perm:manage holder left, the Prompter decides every waiting prompt and approval, so no
    /// call hangs.
    pub(crate) fn settle_unheard(&self) {
        self.settle_approvals();
        let mut prompts = self.prompts();
        if prompts.waiting.is_empty() || !self.holders(&perm_manage()).is_empty() {
            return;
        }
        for (_, waiting) in std::mem::take(&mut prompts.waiting) {
            waiting.tell(&Outcome::Unheard);
        }
    }

    fn prompts(&self) -> MutexGuard<'_, Prompts> {
        self.prompts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
