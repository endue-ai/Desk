//! `perm.pending` returns unanswered prompts and approvals so a prompter can restore its queue.
//! `perm.settled` tells every perm:manage holder to remove an answered or withdrawn request.

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
