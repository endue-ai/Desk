//! The `perm` log channel (ADR 0072): what the permission engine decided, for the person and for
//! `desk perm log`. Every grant (start-up grants included), every refusal of any caller, and every
//! call of an agent, allowed or denied. Each entry carries `caller`, `permission` (its name), `scope`
//! (the permission itself) and `decision`, and `target`, `reason`, `duration` and `grantId` where
//! they apply. A refusal outside an agent's allowlist also tells the person, in a notice naming it.

use std::sync::atomic::Ordering;

use desk_bridge::{
    BridgeEvent, Grant, LogLevel, NotifyLevel, Permission, RefusalReason, UiNotifiedData,
    UiNotifiedEvent,
};
use serde_json::{Map, Value, json};

use crate::agents::agent_of;
use crate::handler::Core;
use crate::perm::Target;

/// The channel the core keeps the permission log in.
pub(crate) const PERM_CHANNEL: &str = "perm";

/// What became of a grant or a call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Verdict {
    /// A grant was made.
    Granted,
    /// An agent's call passed the check.
    Allowed,
    /// A request or call was refused: by the person, the default prompter or the policy.
    Refused,
    /// An agent's call failed the check without anyone being asked (its scope misses the target).
    Denied,
}

impl Verdict {
    fn name(self) -> &'static str {
        match self {
            Self::Granted => "granted",
            Self::Allowed => "allowed",
            Self::Refused => "refused",
            Self::Denied => "denied",
        }
    }
}

impl Core {
    /// A grant was made.
    pub(crate) fn log_grant(&self, caller: &str, grant: &Grant) {
        let mut fields = entry(caller, &grant.permission, Verdict::Granted);
        fields.insert("duration".to_owned(), json!(grant.duration));
        fields.insert("grantId".to_owned(), json!(grant.grant_id));
        let message = format!(
            "{caller} granted {} ({})",
            permission_name(&grant.permission),
            json!(grant.duration).as_str().unwrap_or_default()
        );
        self.append(PERM_CHANNEL, LogLevel::Info, message, Some(fields));
    }

    /// A request or call of `caller` for `scope` (on `target`) came to `verdict`.
    pub(crate) fn log_perm(
        &self,
        caller: &str,
        scope: &Permission,
        target: Option<&Target<'_>>,
        verdict: Verdict,
        reason: Option<RefusalReason>,
    ) {
        let mut fields = entry(caller, scope, verdict);
        let target = target.and_then(target_text);
        let mut message = format!("{caller} {} {}", verdict.name(), permission_name(scope));
        if let Some(target) = &target {
            message.push_str(&format!(" {target}"));
            fields.insert("target".to_owned(), json!(target));
        }
        if let Some(reason) = reason {
            let reason = json!(reason);
            message.push_str(&format!(" ({})", reason.as_str().unwrap_or_default()));
            fields.insert("reason".to_owned(), reason);
        }
        let level = match verdict {
            Verdict::Granted | Verdict::Allowed => LogLevel::Info,
            Verdict::Refused | Verdict::Denied => LogLevel::Warn,
        };
        self.append(PERM_CHANNEL, level, message, Some(fields));
    }

    /// `caller` was refused `scope`: logged, and outside an agent's allowlist the person hears of
    /// it in a notice that names the agent.
    pub(crate) fn refused(
        &self,
        caller: &str,
        scope: &Permission,
        target: Option<&Target<'_>>,
        reason: Option<RefusalReason>,
    ) {
        self.log_perm(caller, scope, target, Verdict::Refused, reason);
        if let (Some(agent), Some(RefusalReason::OutsideAllowlist)) = (agent_of(caller), reason) {
            let what = target
                .and_then(target_text)
                .unwrap_or_else(|| json!(scope).to_string());
            let body = format!(
                "It asked for {} on {what}, outside agents.{agent}.allow in init.yaml.",
                permission_name(scope)
            );
            self.notice(format!("Agent {agent} was refused"), body);
        }
    }

    /// A warning on the person's status line, from the core.
    fn notice(&self, title: String, body: String) {
        let n = self.notifications.fetch_add(1, Ordering::Relaxed) + 1;
        self.events()
            .publish(BridgeEvent::UiNotified(UiNotifiedEvent {
                event: Default::default(),
                data: UiNotifiedData {
                    notification_id: format!("n-{n}"),
                    caller: "core".to_owned(),
                    title,
                    body: Some(body),
                    level: NotifyLevel::Warning,
                },
            }));
    }
}

fn entry(caller: &str, scope: &Permission, verdict: Verdict) -> Map<String, Value> {
    let mut fields = Map::new();
    fields.insert("caller".to_owned(), json!(caller));
    fields.insert("permission".to_owned(), json!(permission_name(scope)));
    fields.insert("scope".to_owned(), json!(scope));
    fields.insert("decision".to_owned(), json!(verdict.name()));
    fields
}

/// A permission's name, such as `fs:write`.
fn permission_name(permission: &Permission) -> String {
    json!(permission)["permission"]
        .as_str()
        .unwrap_or_default()
        .to_owned()
}

/// What a call touches, in words: the path, command, command id, host, URL, setting, event names
/// or link scheme. None when the permission has no target of its own.
pub(crate) fn target_text(target: &Target<'_>) -> Option<String> {
    match target {
        Target::None => None,
        Target::Path(text)
        | Target::Command(text)
        | Target::Host(text)
        | Target::Url(text)
        | Target::CommandId(text)
        | Target::Setting(text) => Some((*text).to_owned()),
        Target::Events(names) => Some(
            names
                .iter()
                .filter_map(|name| json!(name).as_str().map(str::to_owned))
                .collect::<Vec<_>>()
                .join(", "),
        ),
        Target::Scheme(scheme) => json!(scheme).as_str().map(str::to_owned),
        Target::App(app) => app.map(str::to_owned),
    }
}
