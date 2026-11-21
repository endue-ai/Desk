//! Agents are callers (ADR 0072). A tool call the brain routes runs as `agent:<id>`, with grants of
//! its own, and is never granted anything outside `agents.<id>.allow` in init.yaml when that list
//! holds anything: the cap holds at use time, so a grant the agent kept from a wider list allows
//! nothing outside the current one. Inside it, or with an empty list, a call no grant covers asks
//! the person for its scope, remembered per agent by the prompt policy; a command an installed
//! plugin provides runs without the question, since installing the plugin was the person's yes to
//! what it offers (ADR 0268). Every agent call is logged on the `perm` channel (`perm_log`).

use desk_bridge::{BridgeError, GrantDuration, Permission, RefusalReason};

use crate::core_perm::{Decision, refusal};
use crate::handler::{Core, denied};
use crate::agent_tools::ERIS;
use crate::init::Init;
use crate::paths::star_match;
use crate::perm::{Denied, Target, covers, scope_allows};
use crate::perm_log::{Verdict, target_text};
use crate::sync::lock;

/// What an agent's caller id starts with.
pub(crate) const AGENT: &str = "agent:";

/// The runtime, which provides the desk's own commands.
const DESK: &str = "desk";
/// The desk's own commands Eris runs without a question (ADR 0296): windows, tabs, her model and
/// what the person swept for her (Cmd+drag).
const ERIS_DESK_COMMANDS: &[&str] = &["desk.windows.*", "desk.eris.*", "desk.sweep.*"];

/// The longest agent id, so that `agent:<id>` stays within the 128 characters of a caller id.
const MAX_ID: usize = 122;

/// The agent id of an `agent:<id>` caller.
pub(crate) fn agent_of(caller: &str) -> Option<&str> {
    caller.strip_prefix(AGENT)
}

/// The caller an agent id calls as, when it is an id Desk can name (`specs/brain/v0`, `agentId`):
/// a brain's tool call, or a desk socket connection that calls as an agent (ADR 0086).
pub fn agent_caller(id: &str) -> Option<String> {
    let mut chars = id.chars();
    let first = chars.next().is_some_and(|c| c.is_ascii_alphanumeric());
    let rest = chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'));
    (first && rest && id.len() <= MAX_ID).then(|| format!("{AGENT}{id}"))
}

impl Core {
    /// `agents.<agent>.allow` as init.yaml says it now. The file is read again at every call, so an
    /// edit applies to the agent's next call; one that does not parse leaves the setup in force.
    pub(crate) fn allowlist(&self, agent: &str) -> Vec<Permission> {
        let file = lock(&self.init);
        let fresh = file.read().ok().and_then(|text| Init::parse(&text).ok());
        let init = fresh.as_ref().unwrap_or_else(|| file.init());
        init.agents.get(agent).cloned().unwrap_or_default()
    }

    /// Why `caller` may never be granted `permission`: it is an agent whose allowlist holds
    /// something, but nothing that covers it, or a plugin whose manifest does not declare it
    /// (ADR 0260).
    pub(crate) fn capped(&self, caller: &str, permission: &Permission) -> Option<RefusalReason> {
        let Some(agent) = agent_of(caller) else {
            let undeclared = self.undeclared(caller, permission);
            return undeclared.then_some(RefusalReason::Undeclared);
        };
        let allow = self.allowlist(agent);
        let outside = !allow.is_empty() && !allow.iter().any(|a| covers(a, permission));
        outside.then_some(RefusalReason::OutsideAllowlist)
    }

    /// Whether `scope` on `target` runs a command an installed plugin provides: the person
    /// installed the plugin, so an agent runs what it offers without being asked about (ADR 0268).
    /// The desk's own commands and an MCP server's are not a plugin's.
    pub(crate) fn installed_command(&self, scope: &Permission, target: &Target<'_>) -> bool {
        let (Permission::CmdInvoke(_), Target::CommandId(id)) = (scope, target) else {
            return false;
        };
        let provider = self.command(id).map(|info| info.provider);
        provider.is_some_and(|plugin| self.registry().get(&plugin).is_some())
    }

    /// Whether `caller` is Eris running one of the desk's own commands she needs to do what the
    /// person asks on their desk (ADR 0296): her windows and tabs, and her own model. These ask
    /// nothing; an allowlist still caps them, and an irreversible one is still held (ADR 0078).
    pub(crate) fn eris_desk_command(
        &self,
        caller: &str,
        scope: &Permission,
        target: &Target<'_>,
    ) -> bool {
        let (Permission::CmdInvoke(_), Target::CommandId(id)) = (scope, target) else {
            return false;
        };
        agent_of(caller) == Some(ERIS)
            && ERIS_DESK_COMMANDS.iter().any(|pattern| star_match(pattern, id))
            && self.command(id).is_some_and(|info| info.provider == DESK)
    }

    /// The check of an agent's call: refused outside its allowlist whatever it holds, allowed for
    /// an installed plugin's command, Eris's desk commands or by a grant of its own, or else the person is asked for the
    /// scope, for the session, as shell.open asks. Each call is one `perm` log entry.
    pub(crate) fn check_agent(
        &self,
        caller: &str,
        scope: &Permission,
        target: &Target<'_>,
    ) -> Result<(), BridgeError> {
        if scope_allows(scope, target) {
            if let Some(reason) = self.capped(caller, scope) {
                self.refused(caller, scope, Some(target), Some(reason));
                return Err(denied(Denied {
                    permission: scope.clone(),
                    reason: refusal(caller, Some(reason)),
                }));
            }
            if self.installed_command(scope, target) || self.eris_desk_command(caller, scope, target)
            {
                self.log_perm(caller, scope, Some(target), Verdict::Allowed, None);
                return Ok(());
            }
            let held = self.permissions().authorize(caller, scope, target).is_ok();
            if !held {
                let reason = match target_text(target) {
                    Some(target) => format!("Its tool call needs this for {target}"),
                    None => "Its tool call needs this".to_owned(),
                };
                let asked = self.ask(caller, scope, &reason, GrantDuration::Session)?;
                if let Decision::Refused(why) = asked {
                    self.refused(caller, scope, Some(target), why);
                    return Err(denied(Denied {
                        permission: scope.clone(),
                        reason: refusal(caller, why),
                    }));
                }
            }
        }
        let allowed = self.allow_call(caller, scope, target);
        let verdict = if allowed.is_ok() {
            Verdict::Allowed
        } else {
            Verdict::Denied
        };
        self.log_perm(caller, scope, Some(target), verdict, None);
        allowed
    }
}
