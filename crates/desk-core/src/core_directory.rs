//! The brain's agent directory and status side of `Core`: brain.agents.list, brain.agents.card,
//! brain.spaces.list and brain.tasks.list ask the brain (specs/brain/v0) and pass its answer through;
//! brain.status asks whether it answers at all. All five need brain:converse.

use std::sync::Arc;

use desk_brain::{AgentQuery, Brain, BrainFailure, TaskQuery};
use desk_bridge::{
    BrainAgentsCardParams, BrainAgentsListParams, BrainConversePermission, BrainSpacesListParams,
    BrainStatusCloud, BrainStatusLocal, BrainStatusOffline, BrainStatusParams, BrainStatusResult,
    BrainTasksListParams, BridgeError, ErrorCode, Permission,
};
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::conversation::BrainMode;
use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;

impl Core {
    pub(crate) fn brain_agents_list(&self, caller: &str, params: BrainAgentsListParams) -> Answer {
        let brain = self.directory(caller, params.scope)?;
        let query = AgentQuery {
            space_id: params.space_id,
            status: params.status.map(|s| status(s, "agent")).transpose()?,
            page: params.page,
            limit: params.limit,
        };
        json(brain.list_agents(&query).map_err(failed)?)
    }

    pub(crate) fn brain_agents_card(&self, caller: &str, params: BrainAgentsCardParams) -> Answer {
        let brain = self.directory(caller, params.scope)?;
        if params.agent_id.is_empty() {
            return Err(error(
                ErrorCode::InvalidParams,
                "brain.agents.card needs an agentId".to_owned(),
            ));
        }
        json(brain.get_agent_card(&params.agent_id).map_err(failed)?)
    }

    pub(crate) fn brain_spaces_list(&self, caller: &str, params: BrainSpacesListParams) -> Answer {
        let brain = self.directory(caller, params.scope)?;
        json(brain.list_spaces().map_err(failed)?)
    }

    pub(crate) fn brain_tasks_list(&self, caller: &str, params: BrainTasksListParams) -> Answer {
        let brain = self.directory(caller, params.scope)?;
        let query = TaskQuery {
            target_agent_id: params.target_agent_id,
            status: params.status.map(|s| status(s, "A2A task")).transpose()?,
            page: params.page,
            limit: params.limit,
        };
        json(brain.list_a2a_tasks(&query).map_err(failed)?)
    }

    /// Which brain the desk talks to. The brain is asked for its spaces on every call: one it cannot
    /// reach is offline, one that answers anything is the mode the desk was given.
    pub(crate) fn brain_status(&self, caller: &str, params: BrainStatusParams) -> Answer {
        self.converse(caller, params.scope)?;
        let offline = BrainStatusResult::BrainStatusOffline(BrainStatusOffline {
            mode: Default::default(),
        });
        let Some(conversation) = &self.conversation else {
            return json(offline);
        };
        if let Err(BrainFailure::Unreachable(_)) = conversation.brain().list_spaces() {
            return json(offline);
        }
        json(match conversation.mode() {
            BrainMode::Cloud => BrainStatusResult::BrainStatusCloud(BrainStatusCloud {
                mode: Default::default(),
                credits: None,
            }),
            BrainMode::Local { model } => BrainStatusResult::BrainStatusLocal(BrainStatusLocal {
                mode: Default::default(),
                model: model.clone(),
            }),
        })
    }

    fn converse(&self, caller: &str, scope: BrainConversePermission) -> Result<(), BridgeError> {
        self.check(caller, &Permission::BrainConverse(scope), &Target::None)
    }

    /// The brain to ask, once the caller may: a desk without one answers `unsupported`, as brain.say.
    fn directory(
        &self,
        caller: &str,
        scope: BrainConversePermission,
    ) -> Result<Arc<dyn Brain>, BridgeError> {
        self.converse(caller, scope)?;
        let conversation = self.conversation.as_ref().ok_or_else(|| {
            error(
                ErrorCode::Unsupported,
                "no brain is configured for this desk".to_owned(),
            )
        })?;
        Ok(Arc::clone(conversation.brain()))
    }
}

/// A status filter as the brain contract's enum; one it does not name is refused before the brain
/// is asked.
fn status<T: DeserializeOwned>(text: String, what: &str) -> Result<T, BridgeError> {
    serde_json::from_value(Value::String(text.clone())).map_err(|_| {
        error(
            ErrorCode::InvalidParams,
            format!("{text} is not an {what} status"),
        )
    })
}

/// A brain call that failed, as the bridge says it: unreachable is io_error, the brain's 404 and
/// 400 are not_found and invalid_params, anything else is internal.
fn failed(failure: BrainFailure) -> BridgeError {
    let code = match &failure {
        BrainFailure::Unreachable(_) => ErrorCode::IoError,
        BrainFailure::Refused { status: 404, .. } => ErrorCode::NotFound,
        BrainFailure::Refused { status: 400, .. } => ErrorCode::InvalidParams,
        BrainFailure::Refused { .. } | BrainFailure::Protocol(_) => ErrorCode::Internal,
    };
    error(code, failure.to_string())
}
