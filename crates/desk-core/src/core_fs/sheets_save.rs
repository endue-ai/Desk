//! A trusted Sheets command writes one named file through the initiating agent's file policy.

use desk_bridge::{ErrorCode, FsWriteParams};

use crate::approvals::in_task;
use crate::handler::{Answer, Core, error};

impl Core {
    pub(super) fn sheets_save(
        &self,
        provider: &str,
        invocation: &str,
        params: FsWriteParams,
    ) -> Answer {
        if params.append == Some(true)
            || params.create_dirs == Some(true)
            || params.scope.paths.as_slice() != [params.path.as_str()]
            || params.path.contains(['*', '?', '\\', '\0'])
        {
            return Err(error(
                ErrorCode::InvalidParams,
                "Sheets saves one exact file in place".into(),
            ));
        }
        let agent = self.claim_sheets_save(provider, invocation, &params.path)?;
        let write = || self.held_as(Some(&agent.run), || self.write_file(&agent.caller, params));
        match agent.turn {
            Some(turn) => {
                in_task(&turn, || {
                    let answer = write();
                    self.report_approved(&answer);
                    answer
                })
                .0
            }
            None => write(),
        }
    }
}
