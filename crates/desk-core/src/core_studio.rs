//! studio.* (ADR 0122): the person's endue AI agents, served from endue AI's platform API through
//! desk-platform. Every call checks `studio:manage`; the platform's typed errors become the bridge's
//! codes (`signed_out`, `offline`, `forbidden`, `not_found`, `invalid_params`). This file holds the
//! agents themselves; `studio/serve.rs` the facets, the catalog and the conversations.

use std::sync::Arc;

use desk_bridge::{
    BridgeError, ErrorCode, Permission, StudioAgentParams, StudioAgentsCreateParams,
    StudioAgentsCreateResult, StudioAgentsGetResult, StudioAgentsListResult,
    StudioAgentsRemoveResult, StudioAgentsSetStatusParams, StudioAgentsSetStatusResult,
    StudioAgentsUpdateParams, StudioAgentsUpdateResult, StudioManagePermission, StudioParams,
    StudioSwitch, StudioVisibility, StudioWarning, StudioWarningStep,
};
use desk_platform::wire::{
    AgentPatch, Nature, NatureRole, NewAgent, Personality, Profile, SettingsPatch,
};
use desk_platform::{ErrorKind, Platform, PlatformError, SIGN_IN, Switch};

use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;
use crate::studio::{Studio, map};

/// A platform error as the bridge's.
pub(crate) fn failed(e: PlatformError) -> BridgeError {
    let code = match e.kind {
        ErrorKind::SignedOut => ErrorCode::SignedOut,
        ErrorKind::Offline => ErrorCode::Offline,
        ErrorKind::Forbidden => ErrorCode::Forbidden,
        ErrorKind::NotFound => ErrorCode::NotFound,
        ErrorKind::Invalid => ErrorCode::InvalidParams,
        ErrorKind::Conflict => ErrorCode::AlreadyExists,
        ErrorKind::Failed => ErrorCode::IoError,
    };
    error(code, e.message)
}

pub(crate) fn invalid(message: &str) -> BridgeError {
    error(ErrorCode::InvalidParams, message.to_owned())
}

/// `text` trimmed, when it holds something and at most `max` characters.
pub(crate) fn words(text: &str, what: &str, max: usize) -> Result<String, BridgeError> {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.chars().count() > max {
        return Err(invalid(&format!("{what} must be 1 to {max} characters")));
    }
    Ok(trimmed.to_owned())
}

impl Core {
    /// Serve studio.* from `platform` instead of one over the account's token.
    pub fn with_platform(mut self, platform: Platform) -> Self {
        self.studio = Studio::with(platform);
        self
    }

    /// The platform for a call `caller` makes under `scope`: `permission_denied` without the grant,
    /// `signed_out` without an account to take the token from.
    pub(crate) fn platform_for(
        &self,
        caller: &str,
        scope: StudioManagePermission,
    ) -> Result<Arc<Platform>, BridgeError> {
        self.check(caller, &Permission::StudioManage(scope), &Target::None)?;
        self.studio
            .platform(self.account.as_ref())
            .ok_or_else(|| error(ErrorCode::SignedOut, SIGN_IN.to_owned()))
    }

    pub(crate) fn studio_agents_list(&self, caller: &str, params: StudioParams) -> Answer {
        let platform = self.platform_for(caller, params.scope)?;
        let agents = platform.list_agents().map_err(failed)?;
        json(StudioAgentsListResult {
            agents: agents.into_iter().map(map::agent).collect(),
        })
    }

    pub(crate) fn studio_agents_get(&self, caller: &str, params: StudioAgentParams) -> Answer {
        let platform = self.platform_for(caller, params.scope)?;
        let agent = platform.get_agent(&params.agent_id).map_err(failed)?;
        json(StudioAgentsGetResult {
            agent: map::agent(agent),
        })
    }

    pub(crate) fn studio_agents_create(
        &self,
        caller: &str,
        params: StudioAgentsCreateParams,
    ) -> Answer {
        let platform = self.platform_for(caller, params.scope)?;
        let name = words(&params.name, "name", 100)?;
        let role = words(&params.role, "role", 2000)?;
        let languages = params.languages.filter(|l| !l.is_empty());
        let new = NewAgent {
            nature: Nature {
                role: Some(NatureRole::of(&role)),
                personality: Some(
                    params
                        .personality
                        .as_ref()
                        .map_or_else(Personality::default, map::wire_personality),
                ),
                languages: Some(languages.unwrap_or_else(|| vec!["en".to_owned()])),
            },
            profile: Profile {
                name: Some(name),
                description: params.description.filter(|d| !d.trim().is_empty()),
                ..Profile::default()
            },
        };
        let id = platform.create_agent(&new).map_err(failed)?;
        let mut warnings = Vec::new();
        if let Some(model) = params.model.filter(|m| !m.trim().is_empty()) {
            let patch = SettingsPatch {
                visibility: None,
                model: Some(Some(model.clone())),
            };
            if let Err(e) = platform.update_settings(&id, &patch) {
                let code = e
                    .code
                    .unwrap_or_else(|| format!("{:?}", e.kind).to_uppercase());
                warnings.push(StudioWarning {
                    step: StudioWarningStep::Model,
                    code,
                    target: Some(model),
                });
            }
        }
        let agent = platform.get_agent(&id).map_err(failed)?;
        json(StudioAgentsCreateResult {
            agent: map::agent(agent),
            warnings,
        })
    }

    pub(crate) fn studio_agents_update(
        &self,
        caller: &str,
        params: StudioAgentsUpdateParams,
    ) -> Answer {
        let platform = self.platform_for(caller, params.scope)?;
        let name = params
            .name
            .as_deref()
            .map(|n| words(n, "name", 100))
            .transpose()?;
        let role = params
            .role
            .as_deref()
            .map(|r| words(r, "role", 2000))
            .transpose()?;
        let nature = Nature {
            role: role.as_deref().map(NatureRole::of),
            personality: params.personality.as_ref().map(map::wire_personality),
            languages: params.languages.filter(|l| !l.is_empty()),
        };
        let profile = Profile {
            name,
            description: params.description,
            personal_color: params.personal_color,
            avatar_url: None,
        };
        let patch = AgentPatch {
            nature: (nature != Nature::default()).then_some(nature),
            profile: (profile != Profile::default()).then_some(profile),
        };
        let settings = SettingsPatch {
            visibility: params.visibility.map(|v| visibility_name(v).to_owned()),
            model: params
                .model
                .map(|m| Some(m).filter(|m| !m.trim().is_empty())),
        };
        if patch.is_empty() && settings.is_empty() {
            return Err(invalid("studio.agents.update changes at least one field"));
        }
        if !patch.is_empty() {
            platform
                .update_agent(&params.agent_id, &patch)
                .map_err(failed)?;
        }
        if !settings.is_empty() {
            platform
                .update_settings(&params.agent_id, &settings)
                .map_err(failed)?;
        }
        let agent = platform.get_agent(&params.agent_id).map_err(failed)?;
        json(StudioAgentsUpdateResult {
            agent: map::agent(agent),
        })
    }

    pub(crate) fn studio_agents_set_status(
        &self,
        caller: &str,
        params: StudioAgentsSetStatusParams,
    ) -> Answer {
        let platform = self.platform_for(caller, params.scope)?;
        let switch = match params.status {
            StudioSwitch::Active => Switch::Active,
            StudioSwitch::Inactive => Switch::Inactive,
        };
        platform
            .set_status(&params.agent_id, switch)
            .map_err(failed)?;
        let agent = platform.get_agent(&params.agent_id).map_err(failed)?;
        json(StudioAgentsSetStatusResult {
            agent: map::agent(agent),
        })
    }

    pub(crate) fn studio_agents_remove(&self, caller: &str, params: StudioAgentParams) -> Answer {
        let platform = self.platform_for(caller, params.scope)?;
        platform.delete_agent(&params.agent_id).map_err(failed)?;
        json(StudioAgentsRemoveResult {
            agent_id: params.agent_id,
        })
    }
}

fn visibility_name(visibility: StudioVisibility) -> &'static str {
    match visibility {
        StudioVisibility::Public => "public",
        StudioVisibility::Unlisted => "unlisted",
        StudioVisibility::Private => "private",
    }
}
