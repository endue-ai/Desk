//! Authorization for an action that may wait for the person's approval.

use desk_bridge::{BridgeError, Permission};

use crate::agents::agent_of;
use crate::approval_action::Action;
use crate::handler::Core;
use crate::perm_log::Verdict;

impl Core {
    /// The action's approval carries its checked scope for this call.
    pub(crate) fn authorize_action(
        &self,
        caller: &str,
        scope: &Permission,
        action: Action<'_>,
    ) -> Result<bool, BridgeError> {
        let held = self.check_action_scope(caller, scope, &action)?;
        self.hold_checked(caller, scope, action, held)?;
        Ok(held)
    }

    pub(crate) fn check_action_scope(
        &self,
        caller: &str,
        scope: &Permission,
        action: &Action<'_>,
    ) -> Result<bool, BridgeError> {
        let held = self.requires_approval(caller, action);
        let target = action.target();
        if held {
            self.check_approval_scope(caller, scope, &target)?;
        } else {
            self.check(caller, scope, &target)?;
        }
        Ok(held)
    }

    /// Use a grant the agent already holds. The cap still applies and a once grant is spent.
    pub(crate) fn use_action_grant(
        &self,
        caller: &str,
        scope: &Permission,
        action: &Action<'_>,
    ) -> Result<bool, BridgeError> {
        if agent_of(caller).is_none() {
            return Ok(false);
        }
        let target = action.target();
        if self
            .permissions()
            .authorize(caller, scope, &target)
            .is_err()
        {
            return Ok(false);
        }
        self.check_approval_scope(caller, scope, &target)?;
        let granted = self.allow_call(caller, scope, &target).is_ok();
        if granted {
            self.log_perm(caller, scope, Some(&target), Verdict::Allowed, None);
        }
        Ok(granted)
    }
}
