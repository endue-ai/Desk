//! Undo receipts for approved file writes, scoped to the file and retained filesystem version.

use std::collections::VecDeque;

use desk_bridge::{
    ErrorCode, FsWritePermission, PermUndoApprovalParams, PermUndoApprovalResult, Permission,
};

use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;

const MAX_RECEIPTS: usize = 128;

pub(crate) struct WrittenVersion {
    pub path: String,
    pub version: String,
}

#[derive(Default)]
pub(crate) struct UndoVersions(VecDeque<(String, WrittenVersion)>);

impl UndoVersions {
    pub(crate) fn insert(&mut self, id: String, kept: WrittenVersion) {
        if self.0.len() == MAX_RECEIPTS {
            self.0.pop_front();
        }
        self.0.push_back((id, kept));
    }

    fn take(&mut self, id: &str) -> Option<WrittenVersion> {
        let index = self.0.iter().position(|(key, _)| key == id)?;
        self.0.remove(index).map(|(_, kept)| kept)
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
        let written = self
            .approvals()
            .undo
            .take(&params.approval_id)
            .ok_or_else(|| {
                error(
                    ErrorCode::NotFound,
                    "This write can no longer be undone".into(),
                )
            })?;
        let scope = Permission::FsWrite(FsWritePermission {
            permission: Default::default(),
            paths: vec![written.path.clone()],
        });
        if let Err(failure) = self.restore_as(caller, &scope, &written.path, &written.version) {
            self.approvals().undo.insert(params.approval_id, written);
            return Err(failure);
        }
        json(PermUndoApprovalResult::default())
    }
}
