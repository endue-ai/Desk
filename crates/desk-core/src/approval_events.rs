//! Approval cards, stop cancellation and receipts for reversible agent changes.

use std::sync::mpsc;

use desk_bridge::{
    BridgeEvent, PermApprovalDoneData, PermApprovalDoneEvent, PermApprovalEvent, Permission,
};
use serde_json::Value;

use super::{
    Action, AgentChange, Answer, CALL, Choices, Core, Verdict, Waiting, agent_of, perm_manage,
};

impl Core {
    /// Report a completed approval or the receipt for an undoable change to perm:manage holders.
    pub(crate) fn report_approved(&self, result: &Answer) {
        let (approval, change) = CALL.with(|c| {
            let mut call = c.borrow_mut();
            (call.approved.take(), call.change.take())
        });
        let change = change.filter(|_| result.is_ok());
        if approval.is_none() && change.is_none() {
            return;
        }
        let approval_id = approval.unwrap_or_else(|| format!("a-{}", self.next_approval()));
        let undoable = change.is_some().then_some(true);
        let (kind, path) = if let Some(change) = change {
            let (kind, path) = change.notice();
            self.approvals().undo.insert(approval_id.clone(), change);
            (Some(kind), path)
        } else {
            (None, None)
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
            undoable,
            change: kind,
            path,
        };
        let holders = self.holders(&perm_manage());
        let event = BridgeEvent::PermApprovalDone(PermApprovalDoneEvent {
            event: Default::default(),
            data,
        });
        self.events().route(holders, event);
    }

    pub(crate) fn reversible_change(&self, caller: &str, change: impl FnOnce() -> AgentChange) {
        if agent_of(caller).is_some() {
            CALL.with(|call| call.borrow_mut().change = Some(change()));
        }
    }

    pub(crate) fn clear_computer_approvals(&self) {
        let ids = {
            let mut approvals = self.approvals();
            approvals.apps.clear();
            approvals
                .tasks
                .retain(|task| !matches!(task.scope, Permission::ComputerControl(_)));
            approvals
                .waiting
                .iter()
                .filter(|(_, w)| matches!(w.data.permission, Permission::ComputerControl(_)))
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>()
        };
        for id in ids {
            self.cancel_approval(&id, Verdict::Stopped);
        }
    }

    /// Send `perm.approval` to the perm:manage holders and wait for the first answer.
    pub(super) fn ask_approval(
        &self,
        caller: &str,
        scope: &Permission,
        action: &Action<'_>,
        choices: Choices<'_>,
    ) -> (String, Verdict) {
        let holders = self.holders(&perm_manage());
        let seq = self.next_approval();
        let id = format!("a-{seq}");
        if holders.is_empty() || !self.events().has_router() {
            return (id, Verdict::Unheard);
        }
        // The preview may read a file: made before the approval waits, outside the lock.
        let mut data = action.data(caller, scope, &id, choices.task);
        data.until_stop_app = choices.app.map(str::to_owned);
        let (reply, answered) = mpsc::channel();
        let waiting = Waiting {
            reply,
            seq,
            data: data.clone(),
        };
        {
            let mut approvals = self.approvals();
            if choices.computer_epoch.is_some_and(|epoch| {
                self.computer_stopped() || epoch != approvals.apps.generation()
            }) {
                return (id, Verdict::Stopped);
            }
            approvals.waiting.insert(id.clone(), waiting);
            self.run_waits(&id);
            let event = BridgeEvent::PermApproval(PermApprovalEvent {
                event: Default::default(),
                data,
            });
            if self.events().route(holders, event) == 0 {
                approvals.waiting.remove(&id);
                return (id, Verdict::Unheard);
            }
        }
        let verdict = answered.recv().unwrap_or(Verdict::Unheard);
        (id, verdict)
    }
}
