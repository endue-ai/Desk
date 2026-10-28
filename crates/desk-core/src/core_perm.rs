//! The permission side of `Core`: perm.request (with its prompt), perm.query and perm.revoke.

use desk_bridge::{
    BridgeEvent, ErrorCode, Grant, GrantChange, PermChangedData, PermChangedEvent, PermQueryParams,
    PermQueryResult, PermRequestParams, PermRequestResult, PermRevokeParams, PermRevokeResult,
    Permission, PluginStatus,
};

use crate::handler::{Answer, Core, error, json};
use crate::perm::covers;
use crate::prompt::{Prompt, RUNTIME_CALLER};

impl Core {
    /// Grant directly, as the person would through a prompt.
    pub fn grant(&self, caller: &str, permission: Permission) -> Grant {
        let grant = self.permissions().grant(caller, permission);
        self.changed(&grant.grant_id, GrantChange::Granted);
        grant
    }

    /// Take a grant back, as the person would. Work started under it (watches, processes,
    /// captures) ends. Returns whether a grant was removed.
    pub fn revoke(&self, caller: &str, grant_id: &str) -> bool {
        if !self.permissions().revoke(caller, grant_id) {
            return false;
        }
        self.release_grant(grant_id);
        self.changed(grant_id, GrantChange::Revoked);
        true
    }

    /// `caller`'s grants, oldest first.
    pub fn grants_of(&self, caller: &str) -> Vec<Grant> {
        self.permissions().grants(caller)
    }

    pub(crate) fn perm_query(&self, caller: &str, params: PermQueryParams) -> Answer {
        let mut grants = self.permissions().grants(caller);
        if let Some(filter) = &params.permission {
            grants.retain(|grant| covers(&grant.permission, filter));
        }
        json(PermQueryResult { grants })
    }

    /// Ask the person, one prompt at a time. A grant that already covers the request answers
    /// without asking; a plugin may only ask for what its manifest declares, and asking again for
    /// what the person refused (or more) is refused for the rest of the session without a prompt.
    pub(crate) fn perm_request(&self, caller: &str, params: PermRequestParams) -> Answer {
        let refused = || {
            json(PermRequestResult {
                granted: false,
                grant: None,
            })
        };
        // Held across the prompt, so a second request for the same thing finds the first's answer.
        let mut refusals = self
            .refusals
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(grant) = self.covering_grant(caller, &params.permission) {
            return json(PermRequestResult {
                granted: true,
                grant: Some(grant),
            });
        }
        let asked_before = refusals
            .iter()
            .any(|(who, no)| who == caller && covers(&params.permission, no));
        if asked_before {
            return refused();
        }
        let Some(name) = self.askable(caller, &params.permission) else {
            return refused();
        };
        let prompt = Prompt::new(caller, &name, params.permission, &params.reason);
        if !self.prompter.ask(&prompt) {
            refusals.push((caller.to_owned(), prompt.permission));
            return refused();
        }
        let grant = self.grant(caller, prompt.permission);
        json(PermRequestResult {
            granted: true,
            grant: Some(grant),
        })
    }

    pub(crate) fn perm_revoke(&self, caller: &str, params: PermRevokeParams) -> Answer {
        if self.revoke(caller, &params.grant_id) {
            json(PermRevokeResult {})
        } else {
            Err(error(
                ErrorCode::NotFound,
                format!("no grant {}", params.grant_id),
            ))
        }
    }

    fn covering_grant(&self, caller: &str, permission: &Permission) -> Option<Grant> {
        self.permissions()
            .grants(caller)
            .into_iter()
            .find(|grant| covers(&grant.permission, permission))
    }

    /// The name to show when `caller` may ask for `permission`, or `None` when the request is
    /// refused without a prompt: unknown callers, plugins that are off or broken (or not built in,
    /// in safe mode), and anything beyond what the plugin's manifest declares.
    fn askable(&self, caller: &str, permission: &Permission) -> Option<String> {
        if caller == RUNTIME_CALLER {
            return Some("endue Desk".to_owned());
        }
        let info = self.plugins().into_iter().find(|p| p.id == caller)?;
        if info.status != PluginStatus::Ready || !info.enabled || (self.safe_mode && !info.built_in)
        {
            return None;
        }
        let manifest = info.manifest?;
        let declared = manifest.permissions.unwrap_or_default();
        declared
            .iter()
            .any(|d| covers(d, permission))
            .then(|| manifest.name.unwrap_or(info.id))
    }

    fn changed(&self, grant_id: &str, change: GrantChange) {
        self.events()
            .publish(BridgeEvent::PermChanged(PermChangedEvent {
                event: Default::default(),
                data: PermChangedData {
                    grant_id: grant_id.to_owned(),
                    change,
                },
            }));
    }
}
