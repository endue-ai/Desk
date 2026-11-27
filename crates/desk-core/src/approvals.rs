//! Approvals (ADR 0078): an agent's irreversible call waits for the person even when a grant covers
//! it. Irreversible: a write that cannot retain history, `net.fetch`, `proc.spawn`, `cmd.invoke`
//! of a command its provider marks `irreversible`, and
//! every act on the computer (`computer.*`, ADR 0123). The core holds the call after the cap and the permission check, sends `perm.approval` (with a
//! preview, `approval_preview`) to the `perm:manage` holders and waits for `perm.approve`: `once`,
//! `task` (this call and the agent's later calls of the same action the approved scope covers, until
//! the desk's turn they belong to ends) or `deny`. With nobody to ask, the Prompter decides. Once an
//! approved call ran, `perm.approval.done` says what came of it. A caller that is not an agent is
//! never held. The turn a call belongs to, and what became of its approval, ride with the thread
//! that makes the call (`in_task`, `Core::handle`).

#[path = "approval_events.rs"]
mod events;

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::sync::MutexGuard;
use std::sync::mpsc::Sender;

use desk_bridge::{
    ApprovalAnswer, BridgeError, ErrorCode, PendingKind, PermApprovalData, PermApproveParams,
    PermApproveResult, Permission,
};

use crate::agents::agent_of;
pub(crate) use crate::approval_action::Action;
use crate::approval_versions::{AgentChange, UndoChanges};
use crate::computer::AppApprovals;
use crate::core_perm::perm_manage;
use crate::handler::{Answer, Core, denied, error, json as answer};
use crate::perm::{Denied, Target, scope_allows};

/// How the person answered, or that nobody could.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Verdict {
    Once,
    Task,
    App,
    Deny,
    Stopped,
    Unheard,
}

struct Choices<'a> {
    task: Option<&'a str>,
    app: Option<&'a str>,
    computer_epoch: Option<u64>,
}

struct Waiting {
    reply: Sender<Verdict>,
    /// What its perm.approval said, for perm.pending, and its place in the order they came.
    seq: u64,
    data: PermApprovalData,
}

/// What a `task` answer approved: `scope` for `caller` until `task` ends.
struct ForTask {
    caller: String,
    task: String,
    scope: Permission,
    approval_id: String,
    page: Option<(String, String)>,
}

/// The approvals waiting for an answer, by id, and what the person approved for a task.
#[derive(Default)]
pub(crate) struct Approvals {
    next: u64,
    waiting: BTreeMap<String, Waiting>,
    tasks: Vec<ForTask>,
    pub(crate) undo: UndoChanges,
    pub(crate) apps: AppApprovals,
}

/// The thread's call: the task it belongs to, the approval it ran under, and whether one was denied.
#[derive(Default)]
struct Call {
    task: Option<String>,
    approved: Option<String>,
    change: Option<AgentChange>,
    denied: bool,
}

thread_local! {
    static CALL: RefCell<Call> = RefCell::default();
}

/// Run `call` as part of the desk's turn `task`: an agent's irreversible calls it makes on this
/// thread belong to that turn. Returns what `call` returned and whether the person denied one.
pub(crate) fn in_task<T>(task: &str, call: impl FnOnce() -> T) -> (T, bool) {
    let fresh = Call {
        task: Some(task.to_owned()),
        ..Call::default()
    };
    let before = CALL.with(|c| c.replace(fresh));
    let out = call();
    let after = CALL.with(|c| c.replace(before));
    (out, after.denied)
}

pub(crate) fn current_task() -> Option<String> {
    CALL.with(|c| c.borrow().task.clone())
}

impl Core {
    /// Hold `caller`'s call until the person approves it, when the caller is an agent and the call
    /// is irreversible; any other call passes at once. A denial is `permission_denied` for `scope`.
    pub(crate) fn hold(
        &self,
        caller: &str,
        scope: &Permission,
        action: Action<'_>,
    ) -> Result<(), BridgeError> {
        let held = self.requires_approval(caller, &action);
        self.hold_checked(caller, scope, action, held)
    }

    pub(crate) fn hold_checked(
        &self,
        caller: &str,
        scope: &Permission,
        action: Action<'_>,
        held: bool,
    ) -> Result<(), BridgeError> {
        let task = current_task();
        if !held {
            return Ok(());
        }
        let epoch =
            matches!(action, Action::Computer { .. }).then(|| self.approvals().apps.generation());
        let app = action.allowance_app().and_then(|(app, name)| {
            let approvals = self.approvals();
            let generation = approvals.apps.offer(task.as_deref())?;
            Some((app, name, generation, approvals.apps.approved(caller, app)))
        });
        if let Some((_, _, _, Some(id))) = &app {
            self.log_approval(
                caller,
                scope,
                &action,
                id,
                task.as_deref(),
                Some(ApprovalAnswer::App),
            );
            return Ok(());
        }
        if let Some(earlier) = task
            .as_deref()
            .filter(|_| action.narrows())
            .and_then(|t| self.approved_for(caller, t, scope, &action))
        {
            let given = Some(ApprovalAnswer::Task);
            self.log_approval(caller, scope, &action, &earlier, task.as_deref(), given);
            if matches!(action, Action::Write { .. }) {
                // Each write under a task approval can keep a different filesystem version.
                let id = format!("a-{}", self.next_approval());
                CALL.with(|c| c.borrow_mut().approved = Some(id));
            }
            return Ok(());
        }
        // A task answer is offered only for an act it can be narrowed to, and perm.approve takes
        // none for an approval that offers none (ADR 0367).
        let offered = task.as_deref().filter(|_| action.narrows());
        let (id, verdict) = self.ask_approval(
            caller,
            scope,
            &action,
            Choices {
                task: offered,
                app: app.as_ref().map(|(_, name, _, _)| *name),
                computer_epoch: epoch,
            },
        );
        let given = match verdict {
            Verdict::Once => Some(ApprovalAnswer::Once),
            Verdict::Task => {
                let approved = ForTask {
                    caller: caller.to_owned(),
                    task: task.clone().unwrap_or_default(),
                    scope: action.task_scope(scope),
                    approval_id: id.clone(),
                    page: action.page().map(|(v, s)| (v.to_owned(), s.to_owned())),
                };
                let mut approvals = self.approvals();
                if epoch.is_some_and(|epoch| epoch != approvals.apps.generation()) {
                    None
                } else {
                    approvals.tasks.push(approved);
                    Some(ApprovalAnswer::Task)
                }
            }
            Verdict::App => app.and_then(|(app, _, generation, _)| {
                self.approvals()
                    .apps
                    .grant(generation, caller, app, &id)
                    .then_some(ApprovalAnswer::App)
            }),
            Verdict::Unheard if self.prompter.ask(caller, scope, &prompter_reason(&action)) => {
                Some(ApprovalAnswer::Once)
            }
            Verdict::Stopped => {
                return Err(error(
                    ErrorCode::Cancelled,
                    "computer use is stopped".to_owned(),
                ));
            }
            Verdict::Unheard | Verdict::Deny => None,
        };
        self.log_approval(caller, scope, &action, &id, task.as_deref(), given);
        if given.is_none() {
            CALL.with(|c| c.borrow_mut().denied = true);
            let reason = format!(
                "the person did not approve {caller}'s {} of {}",
                action.method(),
                action.target_text()
            );
            return Err(denied(Denied {
                permission: scope.clone(),
                reason,
            }));
        }
        if verdict != Verdict::Unheard {
            CALL.with(|c| c.borrow_mut().approved = Some(id));
        }
        Ok(())
    }

    /// perm.approve: the person's answer to a waiting approval, from a perm:manage holder.
    pub(crate) fn perm_approve(&self, caller: &str, params: PermApproveParams) -> Answer {
        self.check(caller, &Permission::PermManage(params.scope), &Target::None)?;
        let id = params.approval_id;
        let waiting = {
            let mut approvals = self.approvals();
            let Some(waiting) = approvals.waiting.remove(&id) else {
                let missing = format!("no approval {id} is waiting");
                return Err(error(ErrorCode::NotFound, missing));
            };
            if (params.answer == ApprovalAnswer::Task && waiting.data.task.is_none())
                || (params.answer == ApprovalAnswer::App && waiting.data.until_stop_app.is_none())
            {
                // The approval keeps waiting for an answer it can take.
                approvals.waiting.insert(id.clone(), waiting);
                let none = format!("approval {id} does not offer this answer");
                return Err(error(ErrorCode::InvalidParams, none));
            }
            waiting
        };
        self.settled(PendingKind::Approval, &id);
        let _ = waiting.reply.send(match params.answer {
            ApprovalAnswer::Once => Verdict::Once,
            ApprovalAnswer::Task => Verdict::Task,
            ApprovalAnswer::App => Verdict::App,
            ApprovalAnswer::Deny => Verdict::Deny,
        });
        answer(PermApproveResult {})
    }

    /// Deny the waiting approval `id`, as a person's `deny` would (agent.cancel of a waiting run).
    /// False when nothing waits under that id.
    pub(crate) fn deny_approval(&self, id: &str) -> bool {
        self.cancel_approval(id, Verdict::Deny)
    }

    fn cancel_approval(&self, id: &str, verdict: Verdict) -> bool {
        let waiting = self.approvals().waiting.remove(id);
        if waiting.is_some() {
            self.settled(PendingKind::Approval, id);
        }
        waiting.is_some_and(|w| w.reply.send(verdict).is_ok())
    }

    /// The desk's turn `task` ended: what was approved for it ends too.
    pub(crate) fn end_task(&self, task: &str) {
        let mut approvals = self.approvals();
        approvals.tasks.retain(|approved| approved.task != task);
        approvals.apps.end_turn(task);
    }

    /// The approvals waiting for the person, oldest first, as their perm.approval said them.
    pub(crate) fn waiting_approvals(&self) -> Vec<PermApprovalData> {
        let approvals = self.approvals();
        let mut waiting: Vec<&Waiting> = approvals.waiting.values().collect();
        waiting.sort_by_key(|w| w.seq);
        waiting.into_iter().map(|w| w.data.clone()).collect()
    }

    /// With no perm:manage holder left, the Prompter decides every waiting approval.
    pub(crate) fn settle_approvals(&self) {
        if !self.holders(&perm_manage()).is_empty() {
            return;
        }
        for (_, waiting) in std::mem::take(&mut self.approvals().waiting) {
            let _ = waiting.reply.send(Verdict::Unheard);
        }
    }

    pub(crate) fn requires_approval(&self, caller: &str, action: &Action<'_>) -> bool {
        agent_of(caller).is_some() && self.irreversible(action)
    }

    /// Reversible writes and memories with a grant take their own path before this check.
    fn irreversible(&self, action: &Action<'_>) -> bool {
        match action {
            Action::Invoke { id, .. } => self
                .command(id)
                .is_some_and(|info| info.irreversible == Some(true)),
            _ => true,
        }
    }

    /// The approval the person gave `caller` for the rest of `task` that covers `action`.
    fn approved_for(
        &self,
        caller: &str,
        task: &str,
        scope: &Permission,
        action: &Action<'_>,
    ) -> Option<String> {
        let target = action.target();
        self.approvals()
            .tasks
            .iter()
            .find(|a| {
                let page = a.page.as_ref().map(|(v, s)| (v.as_str(), s.as_str()));
                a.caller == caller
                    && a.task == task
                    && page == action.page()
                    && std::mem::discriminant(&a.scope) == std::mem::discriminant(scope)
                    && scope_allows(&a.scope, &target)
            })
            .map(|a| a.approval_id.clone())
    }

    fn next_approval(&self) -> u64 {
        let mut approvals = self.approvals();
        approvals.next += 1;
        approvals.next
    }

    pub(crate) fn approvals(&self) -> MutexGuard<'_, Approvals> {
        self.approvals
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// What the Prompter is asked when nobody holds perm:manage.
fn prompter_reason(action: &Action<'_>) -> String {
    format!(
        "Approve {} of {}: it cannot be undone",
        action.method(),
        action.target_text()
    )
}
