//! What waits for the person (ADR 0204): `perm.pending` answers every prompt and approval nobody has
//! answered yet, for a prompter that comes up while they wait (the island), and `perm.settled` tells
//! every perm:manage holder that one stopped waiting, whoever answered it, so each takes its card
//! down and the island's count goes down.

use desk_bridge::{
    BridgeEvent, PendingKind, PermPendingParams, PermPendingResult, PermSettledData,
    PermSettledEvent, Permission,
};

use crate::core_perm::perm_manage;
use crate::handler::{Answer, Core, json};
use crate::perm::Target;

impl Core {
    /// perm.pending: the prompts and the approvals waiting now, each oldest first.
    pub(crate) fn perm_pending(&self, caller: &str, params: PermPendingParams) -> Answer {
        self.check(caller, &Permission::PermManage(params.scope), &Target::None)?;
        json(PermPendingResult {
            prompts: self.waiting_prompts(),
            approvals: self.waiting_approvals(),
        })
    }

    /// Tell the perm:manage holders that the prompt or approval `id` stopped waiting. Call with no
    /// lock of the prompts or the approvals held.
    pub(crate) fn settled(&self, kind: PendingKind, id: &str) {
        let holders = self.holders(&perm_manage());
        if holders.is_empty() {
            return;
        }
        let event = BridgeEvent::PermSettled(PermSettledEvent {
            event: Default::default(),
            data: PermSettledData {
                kind,
                id: id.to_owned(),
            },
        });
        self.events().route(holders, event);
    }
}
