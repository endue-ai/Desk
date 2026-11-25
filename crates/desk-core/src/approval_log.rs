//! Permission log entries for approved and refused actions.

use desk_bridge::{ApprovalAnswer, LogLevel, Permission};
use serde_json::{Map, json};

use crate::approval_action::Action;
use crate::handler::Core;
use crate::perm_log::PERM_CHANNEL;

impl Core {
    /// One `perm` log entry with the approval and the task: `approved` with how (`once`, `task`),
    /// or `refused` with `reason: not-approved`.
    pub(crate) fn log_approval(
        &self,
        caller: &str,
        scope: &Permission,
        action: &Action<'_>,
        approval_id: &str,
        task: Option<&str>,
        given: Option<ApprovalAnswer>,
    ) {
        let name = json!(scope)["permission"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        let target = action.target_text();
        let mut fields = Map::new();
        fields.insert("caller".to_owned(), json!(caller));
        fields.insert("permission".to_owned(), json!(name));
        fields.insert("scope".to_owned(), json!(scope));
        fields.insert("target".to_owned(), json!(target));
        fields.insert("approvalId".to_owned(), json!(approval_id));
        if let Some(task) = task {
            fields.insert("task".to_owned(), json!(task));
        }
        let (level, message) = match given {
            Some(how) => {
                fields.insert("decision".to_owned(), json!("approved"));
                fields.insert("approval".to_owned(), json!(how));
                let how = json!(how).as_str().unwrap_or_default().to_owned();
                (
                    LogLevel::Info,
                    format!("{caller} approved {name} {target} ({how})"),
                )
            }
            None => {
                fields.insert("decision".to_owned(), json!("refused"));
                fields.insert("reason".to_owned(), json!("not-approved"));
                let message = format!("{caller} refused {name} {target} (not-approved)");
                (LogLevel::Warn, message)
            }
        };
        self.append(PERM_CHANNEL, level, message, Some(fields));
    }
}
