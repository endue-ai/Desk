//! Authenticate the provider of an operation delegated by a pending command.

use desk_bridge::{BridgeError, CommandInfo, ErrorCode, WebAction};
use serde_json::{Map, Value};

use super::{Core, ProviderApproval, error};

const BROWSER: &str = "endue.browser";
const DATABASE: &str = "endue.database";

#[derive(Clone)]
pub(crate) struct AgentInvocation {
    pub(crate) caller: String,
    pub(crate) run: String,
    pub(crate) turn: Option<String>,
}

impl Core {
    pub(crate) fn with_provider_approval(
        &self,
        caller: &str,
        id: &str,
        check: impl FnOnce(&mut ProviderApproval) -> bool,
    ) -> bool {
        self.commands()
            .pending
            .get_mut(id)
            .filter(|invocation| invocation.provider == caller)
            .and_then(|invocation| invocation.approval.as_mut())
            .is_some_and(check)
    }
}

impl Core {
    /// Reuse an irreversible command's review for its exact Database operation.
    pub(crate) fn database_reviewed(
        &self,
        reviewed: bool,
        info: &CommandInfo,
        args: Option<&Map<String, Value>>,
    ) -> Result<bool, BridgeError> {
        if !reviewed || !self.trusted_builtin(&info.provider, DATABASE) {
            return Ok(false);
        }
        let required: &[&str] = match info.id.as_str() {
            "endue.database.drop-object" => &["schema", "name", "kind"],
            "endue.database.truncate-table" => &["schema", "name"],
            "endue.database.drop-policy" => &["schema", "table", "name"],
            "endue.database.end-session" => &[],
            _ => return Ok(false),
        };
        let supplied = |key: &str| {
            args.and_then(|args| args.get(key))
                .and_then(Value::as_str)
                .is_some_and(|name| !name.trim().is_empty())
        };
        let pid = info.id != "endue.database.end-session"
            || args
                .and_then(|args| args.get("pid"))
                .and_then(Value::as_u64)
                .is_some_and(|pid| (1..=i32::MAX as u64).contains(&pid));
        if supplied("connection") && required.iter().all(|k| supplied(k)) && pid {
            return Ok(true);
        }
        Err(error(
            ErrorCode::InvalidParams,
            format!(
                "{} needs the connection and exact operation target before review",
                info.id
            ),
        ))
    }

    pub(crate) fn delegates_web_act(&self, info: &CommandInfo) -> bool {
        matches!(
            info.id.as_str(),
            "endue.browser.click"
                | "endue.browser.type"
                | "endue.browser.key"
                | "endue.browser.select"
        ) && self.trusted_builtin(&info.provider, BROWSER)
    }

    pub(crate) fn cmd_agent(
        &self,
        provider: &str,
        id: &str,
        command: Option<&str>,
    ) -> Result<Option<AgentInvocation>, BridgeError> {
        self.commands()
            .pending
            .get(id)
            .filter(|i| i.provider == provider && command.is_none_or(|command| i.id == command))
            .map(|i| i.agent.clone())
            .ok_or_else(invalid)
    }

    pub(crate) fn claim_browser_act(
        &self,
        provider: &str,
        id: &str,
        action: &WebAction,
    ) -> Result<AgentInvocation, BridgeError> {
        if !self.trusted_builtin(provider, BROWSER) {
            return Err(invalid());
        }
        let command = match action {
            WebAction::WebPress(_) => "endue.browser.click",
            WebAction::WebType(_) => "endue.browser.type",
            WebAction::WebKey(_) => "endue.browser.key",
            WebAction::WebChoose(_) => "endue.browser.select",
            _ => return Err(invalid()),
        };
        let mut commands = self.commands();
        let pending = commands
            .pending
            .get_mut(id)
            .filter(|i| i.provider == provider && i.id == command && i.browser_act)
            .ok_or_else(invalid)?;
        let agent = pending.agent.clone().ok_or_else(invalid)?;
        pending.browser_act = false;
        Ok(agent)
    }
}

fn invalid() -> BridgeError {
    error(
        ErrorCode::InvalidParams,
        "no matching command invocation is pending for this provider".to_owned(),
    )
}
