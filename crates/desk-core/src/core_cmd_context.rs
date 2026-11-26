//! Authenticate the provider of an operation delegated by a pending command.

use desk_bridge::{BridgeError, CommandInfo, ErrorCode, WebAction};
use serde_json::{Map, Value};

use super::{Core, Kind, ProviderApproval, error};
use crate::approval_provider::{DOCKER, DOCKER_STUDIO};

const BROWSER: &str = "endue.browser";
const DATABASE: &str = "endue.database";
const SHEETS: &str = "endue.sheets";
const SHEETS_SAVE: &str = "endue.sheets.save";

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum DelegatedOperation {
    BrowserAction,
    SheetsSave,
}

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
    pub(crate) fn operation_reviewed(
        &self,
        reviewed: bool,
        info: &CommandInfo,
        args: Option<&Map<String, Value>>,
    ) -> Result<bool, BridgeError> {
        if !reviewed {
            return Ok(false);
        }
        if self.trusted_builtin(&info.provider, DATABASE) {
            return Self::database_reviewed(info, args);
        }
        if self.trusted_builtin(&info.provider, DOCKER)
            || self.trusted_builtin(&info.provider, DOCKER_STUDIO)
        {
            return docker_reviewed(info, args);
        }
        Ok(false)
    }

    /// Reuse an irreversible command's review for its exact Database operation.
    fn database_reviewed(
        info: &CommandInfo,
        args: Option<&Map<String, Value>>,
    ) -> Result<bool, BridgeError> {
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

    pub(super) fn delegation(&self, kind: Kind, info: &CommandInfo) -> Option<DelegatedOperation> {
        if kind != Kind::Command {
            return None;
        }
        if info.id == SHEETS_SAVE && self.trusted_builtin(&info.provider, SHEETS) {
            return Some(DelegatedOperation::SheetsSave);
        }
        self.delegates_web_act(info)
            .then_some(DelegatedOperation::BrowserAction)
    }

    fn delegates_web_act(&self, info: &CommandInfo) -> bool {
        matches!(
            info.id.as_str(),
            "endue.browser.click"
                | "endue.browser.type"
                | "endue.browser.key"
                | "endue.browser.navigate-key"
                | "endue.browser.select"
                | "endue.browser.back"
                | "endue.browser.forward"
                | "endue.browser.reload"
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
            WebAction::WebHistory(history) => match history.to {
                desk_bridge::WebStep::Back => "endue.browser.back",
                desk_bridge::WebStep::Forward => "endue.browser.forward",
                desk_bridge::WebStep::Reload => "endue.browser.reload",
                desk_bridge::WebStep::Stop => return Err(invalid()),
            },
            _ => return Err(invalid()),
        };
        let navigation_key = matches!(action, WebAction::WebKey(key) if crate::core_web_control::navigation_key(key.key));
        let mut commands = self.commands();
        let pending = commands
            .pending
            .get_mut(id)
            .filter(|i| {
                i.provider == provider
                    && i.delegation == Some(DelegatedOperation::BrowserAction)
                    && (i.id == command || (i.id == "endue.browser.navigate-key" && navigation_key))
            })
            .ok_or_else(invalid)?;
        let agent = pending.agent.clone().ok_or_else(invalid)?;
        pending.delegation = None;
        Ok(agent)
    }

    pub(crate) fn claim_sheets_save(
        &self,
        provider: &str,
        id: &str,
        path: &str,
    ) -> Result<AgentInvocation, BridgeError> {
        if !self.trusted_builtin(provider, SHEETS) {
            return Err(invalid());
        }
        let mut commands = self.commands();
        let pending = commands
            .pending
            .get_mut(id)
            .filter(|invocation| {
                invocation.provider == provider
                    && invocation.id == SHEETS_SAVE
                    && invocation.delegation == Some(DelegatedOperation::SheetsSave)
                    && invocation
                        .args
                        .as_ref()
                        .and_then(|args| args.get("path"))
                        .and_then(Value::as_str)
                        == Some(path)
            })
            .ok_or_else(invalid)?;
        let agent = pending.agent.clone().ok_or_else(invalid)?;
        pending.delegation = None;
        Ok(agent)
    }
}

fn docker_reviewed(
    info: &CommandInfo,
    args: Option<&Map<String, Value>>,
) -> Result<bool, BridgeError> {
    let argument = |name: &str| args.and_then(|values| values.get(name));
    let named = |name: &str| argument(name).is_some_and(named_value);
    let list = |name: &str| {
        argument(name)
            .and_then(Value::as_array)
            .is_some_and(|items| !items.is_empty() && items.iter().all(named_value))
    };
    let valid = match info.id.as_str() {
        "endue.docker.kill" | "endue.docker.remove" => {
            if argument("containers").is_some() {
                list("containers")
            } else {
                named("container")
            }
        }
        "endue.docker.remove-image"
        | "endue.docker-studio.remove-image"
        | "endue.docker-studio.push" => named("image"),
        "endue.docker.remove-volume" | "endue.docker-studio.volume-remove" => named("volume"),
        "endue.docker.remove-network" | "endue.docker-studio.network-remove" => named("network"),
        "endue.docker.down" => named("project") || named("file"),
        "endue.docker.prune"
        | "endue.docker.prune-images"
        | "endue.docker.prune-volumes"
        | "endue.docker.prune-networks" => true,
        "endue.docker-studio.kill" | "endue.docker-studio.remove" => list("containers"),
        "endue.docker-studio.compose-down" => named("stack"),
        "endue.docker-studio.prune" => list("kinds"),
        _ => return Ok(false),
    };
    if valid {
        return Ok(true);
    }
    Err(error(
        ErrorCode::InvalidParams,
        format!("{} needs an exact operation target before review", info.id),
    ))
}

fn named_value(value: &Value) -> bool {
    value.as_str().is_some_and(|name| !name.trim().is_empty())
}

fn invalid() -> BridgeError {
    error(
        ErrorCode::InvalidParams,
        "no matching command invocation is pending for this provider".to_owned(),
    )
}
