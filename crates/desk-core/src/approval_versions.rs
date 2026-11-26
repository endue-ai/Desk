//! Bounded Undo receipts for the exact file or fact changed by an agent.

use std::collections::VecDeque;

use desk_bridge::{
    ApprovalChange, ErrorCode, MemoryFact, PermUndoApprovalParams, PermUndoApprovalResult,
    Permission,
};

use crate::core_fs::FileChange;
use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;

const MAX_RECEIPTS: usize = 128;

pub(crate) enum AgentChange {
    File(FileChange),
    Fact {
        previous: Option<Box<MemoryFact>>,
        saved: Box<MemoryFact>,
    },
}

impl AgentChange {
    pub(crate) fn notice(&self) -> (ApprovalChange, Option<String>) {
        match self {
            Self::File(file) => {
                let kind = if file.version.is_some() {
                    ApprovalChange::FileSaved
                } else {
                    ApprovalChange::FileCreated
                };
                (kind, Some(file.path.clone()))
            }
            Self::Fact { previous, .. } => {
                let kind = if previous.is_some() {
                    ApprovalChange::FactEdited
                } else {
                    ApprovalChange::FactRemembered
                };
                (kind, None)
            }
        }
    }
}

#[derive(Default)]
pub(crate) struct UndoChanges(VecDeque<(String, AgentChange)>);

impl UndoChanges {
    pub(crate) fn insert(&mut self, id: String, change: AgentChange) {
        if self.0.len() == MAX_RECEIPTS {
            self.0.pop_front();
        }
        self.0.push_back((id, change));
    }

    fn take(&mut self, id: &str) -> Option<AgentChange> {
        let index = self.0.iter().position(|(key, _)| key == id)?;
        self.0.remove(index).map(|(_, change)| change)
    }
}

impl Core {
    pub(crate) fn perm_undo_approval(
        &self,
        caller: &str,
        params: PermUndoApprovalParams,
    ) -> Answer {
        if caller != "desk" {
            return Err(error(
                ErrorCode::PermissionDenied,
                "Undo needs the desk".into(),
            ));
        }
        self.check(caller, &Permission::PermManage(params.scope), &Target::None)?;
        let change = self
            .approvals()
            .undo
            .take(&params.approval_id)
            .ok_or_else(|| {
                error(
                    ErrorCode::NotFound,
                    "This change can no longer be undone".into(),
                )
            })?;
        let reversed = match &change {
            AgentChange::File(file) => self.undo_file_change(caller, file),
            AgentChange::Fact { previous, saved } => {
                self.undo_fact_change(saved, previous.as_deref())
            }
        };
        if let Err(failure) = reversed {
            self.approvals().undo.insert(params.approval_id, change);
            return Err(failure);
        }
        json(PermUndoApprovalResult::default())
    }
}
