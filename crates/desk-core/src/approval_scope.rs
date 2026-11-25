//! Authorization for an action that may wait for the person's approval.

use desk_bridge::{BridgeError, Permission};

use crate::approval_action::Action;
use crate::handler::Core;

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
}
