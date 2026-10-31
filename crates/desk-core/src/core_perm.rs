//! The perm side of `Core`: the one permission check every call passes, grants for every duration,
//! perm.query, perm.request, perm.revoke and perm.list, and `perm.changed` for the holder and the
//! callers subscribed to it. `always` grants live in the grant file (ADR 0029); asking the person
//! goes through `perm.prompt` (`core_prompts`) or, with nobody to prompt, the `Prompter`.

use std::path::PathBuf;

use desk_bridge::{
    BridgeError, BridgeEvent, ErrorCode, EventName, Grant, GrantChange, GrantDuration,
    PermChangedData, PermChangedEvent, PermListParams, PermListResult, PermManagePermission,
    PermQueryParams, PermQueryResult, PermRequestParams, PermRequestResult, PermRevokeParams,
    PermRevokeResult, Permission,
};

use crate::core_prompts::Outcome;
use crate::handler::{Answer, Core, denied, error, json};
use crate::perm::{PermissionEngine, Target, covers};

/// Asks the person whether to grant a permission when no caller holding perm:manage can be asked
/// through `perm.prompt`. The asked duration applies.
pub trait Prompter: Send + Sync {
    fn ask(&self, caller: &str, permission: &Permission, reason: &str) -> bool;
}

/// The prompter used until a prompt UI exists: it refuses everything.
#[derive(Debug, Default)]
pub struct RefuseAll;

impl Prompter for RefuseAll {
    fn ask(&self, _caller: &str, _permission: &Permission, _reason: &str) -> bool {
        false
    }
}

impl Core {
    /// Keep `always` grants in `path` (a JSON file in the app's data folder, next to plugins.json)
    /// and start with the ones it holds. Call it before granting anything.
    pub fn with_grant_file(self, path: PathBuf) -> Self {
        *self.permissions() = PermissionEngine::with_file(path);
        self
    }

    /// Grant for the session, as the person would through a prompt.
    pub fn grant(&self, caller: &str, permission: Permission) -> Grant {
        self.grant_for(caller, permission, GrantDuration::Session)
    }

    pub(crate) fn grant_for(
        &self,
        caller: &str,
        permission: Permission,
        duration: GrantDuration,
    ) -> Grant {
        let grant = self.permissions().grant_for(caller, permission, duration);
        self.changed(caller, &grant.grant_id, GrantChange::Granted);
        grant
    }

    /// The permission check every call passes: a grant of the caller's must cover the scope and the
    /// scope the target. A `once` grant that allows the call is spent here, before the call runs: its
    /// holder hears `expired`, and what only it covered ends.
    pub(crate) fn check(
        &self,
        caller: &str,
        scope: &Permission,
        target: &Target<'_>,
    ) -> Result<(), BridgeError> {
        let spent = self
            .permissions()
            .allow(caller, scope, target)
            .map_err(denied)?;
        if let Some(grant) = spent {
            self.changed(caller, &grant.grant_id, GrantChange::Expired);
            self.lost_grant(caller);
        }
        Ok(())
    }

    /// The callers holding a grant that covers `scope`, leaving out plugins that are not running.
    pub(crate) fn holders(&self, scope: &Permission) -> Vec<String> {
        let mut holders = self.permissions().holders(scope);
        holders.retain(|caller| self.running(caller));
        holders
    }

    pub(crate) fn perm_query(&self, caller: &str, params: PermQueryParams) -> Answer {
        let mut grants = self.permissions().grants(caller);
        if let Some(filter) = &params.permission {
            grants.retain(|grant| covers(&grant.permission, filter));
        }
        json(PermQueryResult { grants })
    }

    /// Ask the person; the call waits for the answer. A refusal is a result, not an error.
    pub(crate) fn perm_request(&self, caller: &str, params: PermRequestParams) -> Answer {
        let asked = params.duration.unwrap_or(GrantDuration::Session);
        let grant = match self.prompt(caller, &params.permission, &params.reason, asked) {
            Outcome::Granted(grant) => Some(grant),
            Outcome::Refused => None,
            Outcome::Withdrawn => {
                return Err(error(
                    ErrorCode::Cancelled,
                    format!("{caller} stopped before the person answered"),
                ));
            }
            Outcome::Unheard => self
                .prompter
                .ask(caller, &params.permission, &params.reason)
                .then(|| self.grant_for(caller, params.permission, asked)),
        };
        json(PermRequestResult {
            granted: grant.is_some(),
            grant,
        })
    }

    /// Give a grant back: one's own without a scope, anyone's with perm:manage.
    pub(crate) fn perm_revoke(&self, caller: &str, params: PermRevokeParams) -> Answer {
        let holder = match params.scope {
            Some(scope) => {
                self.check(caller, &Permission::PermManage(scope), &Target::None)?;
                self.permissions().revoke_any(&params.grant_id)
            }
            None => {
                let revoked = self.permissions().revoke(caller, &params.grant_id);
                revoked.then(|| caller.to_owned())
            }
        };
        let holder = holder
            .ok_or_else(|| error(ErrorCode::NotFound, format!("no grant {}", params.grant_id)))?;
        self.changed(&holder, &params.grant_id, GrantChange::Revoked);
        self.lost_grant(&holder);
        json(PermRevokeResult {})
    }

    /// Every caller's grants, oldest first, or one caller's.
    pub(crate) fn perm_list(&self, caller: &str, params: PermListParams) -> Answer {
        self.check(caller, &Permission::PermManage(params.scope), &Target::None)?;
        let mut grants = self.permissions().list();
        if let Some(only) = &params.caller {
            grants.retain(|held| &held.caller == only);
        }
        json(PermListResult { grants })
    }

    /// A grant of `caller`'s went (revoked, spent): the watches, file URLs, subscriptions (events and
    /// data) and processes no grant covers any more end, and prompts that nobody can answer any more
    /// go to the Prompter.
    pub(crate) fn lost_grant(&self, caller: &str) {
        self.prune_watches(caller);
        self.prune_file_urls(caller);
        self.prune_subscriptions(caller);
        self.prune_data(caller);
        self.prune_processes(caller);
        self.settle_unheard();
    }

    /// `perm.changed` for the grant's holder and the callers subscribed to it.
    pub(crate) fn changed(&self, holder: &str, grant_id: &str, change: GrantChange) {
        let to = self.recipients(EventName::PermChanged, vec![holder.to_owned()]);
        self.events().publish_to(
            to,
            BridgeEvent::PermChanged(PermChangedEvent {
                event: Default::default(),
                data: PermChangedData {
                    grant_id: grant_id.to_owned(),
                    change,
                },
            }),
        );
    }
}

/// The perm:manage scope.
pub(crate) fn perm_manage() -> Permission {
    Permission::PermManage(PermManagePermission {
        permission: Default::default(),
    })
}
