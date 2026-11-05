//! Approvals (ADR 0078): an agent's irreversible call waits for the person even when a grant covers
//! it. Irreversible: `fs.write` to a path and `net.fetch` to a host no `always` grant of the agent
//! allows, `proc.spawn`, and `cmd.invoke` of a command its provider's manifest marks `irreversible`.
//! The core holds the call after the cap and the permission check, sends `perm.approval` (with a
//! preview, `approval_preview`) to the `perm:manage` holders and waits for `perm.approve`: `once`,
//! `task` (this call and the agent's later calls of the same action the approved scope covers, until
//! the desk's turn they belong to ends) or `deny`. With nobody to ask, the Prompter decides. Once an
//! approved call ran, `perm.approval.done` says what came of it. A caller that is not an agent is
//! never held. The turn a call belongs to, and what became of its approval, ride with the thread
//! that makes the call (`in_task`, `Core::handle`).

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::sync::MutexGuard;
use std::sync::mpsc::{self, Sender};

use desk_bridge::{
    ApprovalAnswer, BridgeError, BridgeEvent, ErrorCode, GrantDuration, LogLevel,
    PermApprovalDoneData, PermApprovalDoneEvent, PermApprovalEvent, PermApproveParams,
    PermApproveResult, Permission,
};
use serde_json::{Map, Value, json};

use crate::agents::agent_of;
pub(crate) use crate::approval_action::Action;
use crate::core_perm::perm_manage;
use crate::handler::{Answer, Core, denied, error, json as answer};
use crate::perm::{Denied, Target, scope_allows};
use crate::perm_log::PERM_CHANNEL;

/// How the person answered, or that nobody could.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Verdict {
    Once,
    Task,
    Deny,
    Unheard,
}

struct Waiting {
    task: Option<String>,
    reply: Sender<Verdict>,
}

/// What a `task` answer approved: `scope` for `caller` until `task` ends.
struct ForTask {
    caller: String,
    task: String,
    scope: Permission,
    approval_id: String,
}

/// The approvals waiting for an answer, by id, and what the person approved for a task.
#[derive(Default)]
pub(crate) struct Approvals {
    next: u64,
    waiting: BTreeMap<String, Waiting>,
    tasks: Vec<ForTask>,
}

/// The thread's call: the task it belongs to, the approval it ran under, and whether one was denied.
#[derive(Default)]
struct Call {
    task: Option<String>,
    approved: Option<String>,
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

impl Core {
    /// Hold `caller`'s call until the person approves it, when the caller is an agent and the call
    /// is irreversible; any other call passes at once. A denial is `permission_denied` for `scope`.
    pub(crate) fn hold(
        &self,
        caller: &str,
        scope: &Permission,
        action: Action<'_>,
    ) -> Result<(), BridgeError> {
        if agent_of(caller).is_none() || !self.irreversible(caller, &action) {
            return Ok(());
        }
        let task = CALL.with(|c| c.borrow().task.clone());
        if let Some(earlier) = task
            .as_deref()
            .and_then(|t| self.approved_for(caller, t, &action))
        {
            let given = Some(ApprovalAnswer::Task);
            self.log_approval(caller, scope, &action, &earlier, task.as_deref(), given);
            return Ok(());
        }
        let (id, verdict) = self.ask_approval(caller, scope, &action, task.as_deref());
        let given = match verdict {
            Verdict::Once => Some(ApprovalAnswer::Once),
            Verdict::Task => {
                let approved = ForTask {
                    caller: caller.to_owned(),
                    task: task.clone().unwrap_or_default(),
                    scope: action.task_scope(scope),
                    approval_id: id.clone(),
                };
                self.approvals().tasks.push(approved);
                Some(ApprovalAnswer::Task)
            }
            Verdict::Unheard if self.prompter.ask(caller, scope, &prompter_reason(&action)) => {
                Some(ApprovalAnswer::Once)
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
            if params.answer == ApprovalAnswer::Task && waiting.task.is_none() {
                // The approval keeps waiting for an answer it can take.
                approvals.waiting.insert(id.clone(), waiting);
                let none = format!("approval {id} belongs to no task");
                return Err(error(ErrorCode::InvalidParams, none));
            }
            waiting
        };
        let _ = waiting.reply.send(match params.answer {
            ApprovalAnswer::Once => Verdict::Once,
            ApprovalAnswer::Task => Verdict::Task,
            ApprovalAnswer::Deny => Verdict::Deny,
        });
        answer(PermApproveResult {})
    }

    /// Deny the waiting approval `id`, as a person's `deny` would (agent.cancel of a waiting run).
    /// False when nothing waits under that id.
    pub(crate) fn deny_approval(&self, id: &str) -> bool {
        let waiting = self.approvals().waiting.remove(id);
        waiting.is_some_and(|w| w.reply.send(Verdict::Deny).is_ok())
    }

    /// The call on this thread ended with `result`: when it ran under an approval the person gave
    /// on a card, the perm:manage holders hear `perm.approval.done`.
    pub(crate) fn report_approved(&self, result: &Answer) {
        let Some(approval_id) = CALL.with(|c| c.borrow_mut().approved.take()) else {
            return;
        };
        let data = PermApprovalDoneData {
            approval_id,
            ok: result.is_ok(),
            bytes_written: result
                .as_ref()
                .ok()
                .and_then(|r| r.get("bytesWritten"))
                .and_then(Value::as_u64),
            error: result.as_ref().err().cloned(),
            undoable: None,
        };
        let holders = self.holders(&perm_manage());
        let event = BridgeEvent::PermApprovalDone(PermApprovalDoneEvent {
            event: Default::default(),
            data,
        });
        self.events().route(holders, event);
    }

    /// The desk's turn `task` ended: what was approved for it ends too.
    pub(crate) fn end_task(&self, task: &str) {
        self.approvals()
            .tasks
            .retain(|approved| approved.task != task);
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

    /// Whether `action` waits for the person: a write or a fetch no `always` grant of the caller
    /// allows, any spawn, a command marked irreversible.
    fn irreversible(&self, caller: &str, action: &Action<'_>) -> bool {
        match action {
            // An always grant lets an agent write files, fetch and remember freely (ADR 0096).
            Action::Write { .. } | Action::Fetch { .. } | Action::Remember { .. } => {
                let target = action.target();
                !self.permissions().grants(caller).iter().any(|grant| {
                    grant.duration == GrantDuration::Always
                        && scope_allows(&grant.permission, &target)
                })
            }
            Action::Spawn { .. } => true,
            Action::Invoke { id, .. } => self.irreversible_command(id),
        }
    }

    /// The approval the person gave `caller` for the rest of `task` that covers `action`.
    fn approved_for(&self, caller: &str, task: &str, action: &Action<'_>) -> Option<String> {
        let target = action.target();
        self.approvals()
            .tasks
            .iter()
            .find(|a| a.caller == caller && a.task == task && scope_allows(&a.scope, &target))
            .map(|a| a.approval_id.clone())
    }

    /// Send `perm.approval` to the perm:manage holders and wait for the first answer.
    fn ask_approval(
        &self,
        caller: &str,
        scope: &Permission,
        action: &Action<'_>,
        task: Option<&str>,
    ) -> (String, Verdict) {
        let holders = self.holders(&perm_manage());
        let (id, answered) = {
            let mut approvals = self.approvals();
            approvals.next += 1;
            let id = format!("a-{}", approvals.next);
            if holders.is_empty() || !self.events().has_router() {
                return (id, Verdict::Unheard);
            }
            let (reply, answered) = mpsc::channel();
            let task = task.map(str::to_owned);
            approvals
                .waiting
                .insert(id.clone(), Waiting { task, reply });
            (id, answered)
        };
        self.run_waits(&id);
        let event = BridgeEvent::PermApproval(PermApprovalEvent {
            event: Default::default(),
            data: action.data(caller, scope, &id, task),
        });
        if self.events().route(holders, event) == 0 {
            self.approvals().waiting.remove(&id);
            return (id, Verdict::Unheard);
        }
        let verdict = answered.recv().unwrap_or(Verdict::Unheard);
        (id, verdict)
    }

    /// One `perm` log entry with the approval and the task: `approved` with how (`once`, `task`),
    /// or `refused` with `reason: not-approved`.
    fn log_approval(
        &self,
        caller: &str,
        scope: &Permission,
        action: &Action<'_>,
        approval_id: &str,
        task: Option<&str>,
        given: Option<ApprovalAnswer>,
    ) {
        let name = json!(scope)["permission"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        let target = action.target_text();
        let mut fields = Map::new();
        fields.insert("caller".to_owned(), json!(caller));
        fields.insert("permission".to_owned(), json!(name));
        fields.insert("scope".to_owned(), json!(scope));
        fields.insert("target".to_owned(), json!(target));
        fields.insert("approvalId".to_owned(), json!(approval_id));
        if let Some(task) = task {
            fields.insert("task".to_owned(), json!(task));
        }
        let (level, message) = match given {
            Some(how) => {
                fields.insert("decision".to_owned(), json!("approved"));
                fields.insert("approval".to_owned(), json!(how));
                let how = json!(how).as_str().unwrap_or_default().to_owned();
                (
                    LogLevel::Info,
                    format!("{caller} approved {name} {target} ({how})"),
                )
            }
            None => {
                fields.insert("decision".to_owned(), json!("refused"));
                fields.insert("reason".to_owned(), json!("not-approved"));
                let message = format!("{caller} refused {name} {target} (not-approved)");
                (LogLevel::Warn, message)
            }
        };
        self.append(PERM_CHANNEL, level, message, Some(fields));
    }

    fn approvals(&self) -> MutexGuard<'_, Approvals> {
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
