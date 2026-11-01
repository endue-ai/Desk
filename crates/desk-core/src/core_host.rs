//! The core as the connector host sees it: `desk_plugin_host::Host` (every `desk:host` import)
//! and `IndexSink` (where syncs land). Each import is `Core::handle` as the plugin, with the
//! narrowest scope (the path, the command id, the event names), so the person's grants decide;
//! store calls reach the core store directly, the host's own `desk.` keys included; what the core
//! does not serve yet answers `unsupported`. It holds the core weakly: the core holds the host.

use std::sync::{Arc, Weak};

use base64::Engine as _;
use desk_bridge::{BridgeError, BridgeRequest, BridgeResponse, Item, ItemSource};
use desk_plugin_host::{
    Command, CommandInfo, Decision, DirEntry, Duration, EntryKind, Error, ErrorCode, Failure,
    FailureCode, Grant, Host, IndexSink, LogEntry, LogLevel, NotifyLevel, Request, Response,
    Setting,
};
use serde_json::{Value, json};

use crate::handler::Core;

/// The core behind the connector host's `Host` and `IndexSink`.
pub(crate) struct CoreHost(Weak<Core>);

impl CoreHost {
    pub(crate) fn new(core: Weak<Core>) -> Self {
        Self(core)
    }

    fn core(&self) -> Result<Arc<Core>, Error> {
        self.0.upgrade().ok_or_else(|| Error {
            code: ErrorCode::Cancelled,
            message: "the desk is shutting down".to_owned(),
        })
    }

    /// One bridge call as `plugin`.
    fn ask(&self, plugin: &str, method: &str, params: Value) -> Result<Value, Error> {
        let core = self.core()?;
        let request = json!({ "id": 0, "method": method, "params": params });
        let request: BridgeRequest = serde_json::from_value(request).map_err(|e| Error {
            code: ErrorCode::InvalidParams,
            message: format!("{method}: {e}"),
        })?;
        match core.handle(plugin, request) {
            BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
            BridgeResponse::BridgeFailure(failure) => Err(wit_error(failure.error)),
        }
    }
}

impl Host for CoreHost {
    fn fs_read(&self, plugin: &str, path: &str) -> Result<Vec<u8>, Error> {
        let scope = json!({ "permission": "fs:read", "paths": [path] });
        let params = json!({ "path": path, "encoding": "base64", "scope": scope });
        let read = self.ask(plugin, "fs.read", params)?;
        let content = read["content"].as_str().unwrap_or_default();
        base64::engine::general_purpose::STANDARD
            .decode(content)
            .map_err(|e| internal(e.to_string()))
    }

    fn fs_list(&self, plugin: &str, path: &str) -> Result<Vec<DirEntry>, Error> {
        let scope = json!({ "permission": "fs:read", "paths": [path] });
        let listed = self.ask(plugin, "fs.list", json!({ "path": path, "scope": scope }))?;
        let entries: Vec<desk_bridge::DirEntry> = serde_json::from_value(listed["entries"].clone())
            .map_err(|e| internal(e.to_string()))?;
        Ok(entries
            .into_iter()
            .map(|entry| DirEntry {
                name: entry.name,
                kind: match entry.kind {
                    desk_bridge::EntryKind::File => EntryKind::File,
                    desk_bridge::EntryKind::Dir => EntryKind::Dir,
                    desk_bridge::EntryKind::Symlink => EntryKind::Symlink,
                },
                size: entry.size,
                modified_at: entry.modified_at,
            })
            .collect())
    }

    fn fs_write(
        &self,
        plugin: &str,
        path: &str,
        contents: &[u8],
        create_dirs: bool,
    ) -> Result<u64, Error> {
        let scope = json!({ "permission": "fs:write", "paths": [path] });
        let content = base64::engine::general_purpose::STANDARD.encode(contents);
        let params = json!({
            "path": path, "content": content, "encoding": "base64", "createDirs": create_dirs,
            "scope": scope,
        });
        let written = self.ask(plugin, "fs.write", params)?;
        Ok(written["bytesWritten"].as_u64().unwrap_or_default())
    }

    fn net_fetch(&self, _plugin: &str, _request: Request) -> Result<Response, Error> {
        Err(unsupported("net.fetch"))
    }

    fn ui_notify(
        &self,
        plugin: &str,
        title: &str,
        body: Option<&str>,
        level: NotifyLevel,
    ) -> Result<(), Error> {
        let level = match level {
            NotifyLevel::Info => "info",
            NotifyLevel::Success => "success",
            NotifyLevel::Warning => "warning",
            NotifyLevel::Error => "error",
        };
        let scope = json!({ "permission": "ui:notify" });
        let mut params = json!({ "title": title, "level": level, "scope": scope });
        if let Some(body) = body {
            params["body"] = json!(body);
        }
        self.ask(plugin, "ui.notify", params).map(drop)
    }

    fn perm_query(&self, plugin: &str) -> Vec<Grant> {
        let grants = self
            .ask(plugin, "perm.query", json!({}))
            .unwrap_or_default();
        let grants = grants["grants"].as_array().cloned().unwrap_or_default();
        grants.iter().map(grant).collect()
    }

    fn perm_request(
        &self,
        plugin: &str,
        permission: Value,
        reason: &str,
        duration: Option<Duration>,
    ) -> Result<Decision, Error> {
        let mut params = json!({ "permission": permission, "reason": reason });
        if let Some(duration) = duration {
            params["duration"] = json!(match duration {
                Duration::Once => "once",
                Duration::Session => "session",
                Duration::Always => "always",
            });
        }
        let decided = self.ask(plugin, "perm.request", params)?;
        Ok(Decision {
            granted: decided["granted"].as_bool().unwrap_or(false),
            grant: decided.get("grant").map(grant),
        })
    }

    fn store_get(&self, plugin: &str, key: &str) -> Result<Option<Value>, Error> {
        Ok(self.core()?.stored(plugin, key))
    }

    fn store_set(&self, plugin: &str, key: &str, value: Value) -> Result<(), Error> {
        let core = self.core()?;
        core.store_put(plugin, key, value).map_err(|message| Error {
            code: ErrorCode::InvalidParams,
            message,
        })
    }

    fn cmd_register(&self, plugin: &str, command: Command) -> Result<(), Error> {
        let mut params = json!({ "id": command.id, "title": command.title });
        if let Some(description) = command.description {
            params["description"] = json!(description);
        }
        if !command.keywords.is_empty() {
            params["keywords"] = json!(command.keywords);
        }
        if let Some(schema) = command.args_schema {
            let schema: Value = serde_json::from_str(&schema).map_err(|e| Error {
                code: ErrorCode::InvalidParams,
                message: format!("cmd.register takes args-schema as JSON text: {e}"),
            })?;
            params["argsSchema"] = schema;
        }
        if let Some(when) = command.when {
            params["when"] = json!(when);
        }
        self.ask(plugin, "cmd.register", params).map(drop)
    }

    fn cmd_unregister(&self, plugin: &str, id: &str) -> Result<(), Error> {
        self.ask(plugin, "cmd.unregister", json!({ "id": id }))
            .map(drop)
    }

    fn cmd_list(&self, plugin: &str) -> Result<Vec<CommandInfo>, Error> {
        let core = self.core()?;
        Ok(core
            .commands_covered(plugin)
            .into_iter()
            .map(|info| CommandInfo {
                command: Command {
                    id: info.id,
                    title: info.title,
                    description: info.description,
                    keywords: info.keywords.unwrap_or_default(),
                    args_schema: info.args_schema.map(|s| Value::Object(s).to_string()),
                    when: info.when,
                },
                provider: info.provider,
            })
            .collect())
    }

    fn cmd_invoke(&self, plugin: &str, id: &str, args: Option<Value>) -> Result<String, Error> {
        let scope = json!({ "permission": "cmd:invoke", "ids": [id] });
        let mut params = json!({ "id": id, "scope": scope });
        if let Some(args) = args {
            params["args"] = args;
        }
        let invoked = self.ask(plugin, "cmd.invoke", params)?;
        Ok(invoked["invocationId"]
            .as_str()
            .unwrap_or_default()
            .to_owned())
    }

    fn cmd_answer(
        &self,
        plugin: &str,
        invocation_id: &str,
        outcome: Result<Value, Failure>,
    ) -> Result<(), Error> {
        let mut params = json!({ "invocationId": invocation_id });
        match outcome {
            Ok(result) => params["result"] = result,
            Err(failure) => {
                let code = match failure.code {
                    FailureCode::Failed => "failed",
                    FailureCode::Cancelled => "cancelled",
                };
                params["error"] = json!({ "code": code, "message": failure.message });
            }
        }
        self.ask(plugin, "cmd.answer", params).map(drop)
    }

    fn events_subscribe(&self, plugin: &str, names: &[String]) -> Result<String, Error> {
        let scope = json!({ "permission": "events:subscribe", "names": names });
        let params = json!({ "names": names, "scope": scope });
        let subscribed = self.ask(plugin, "events.subscribe", params)?;
        let id = subscribed["subscriptionId"].as_str().unwrap_or_default();
        Ok(id.to_owned())
    }

    fn events_unsubscribe(&self, plugin: &str, subscription_id: &str) -> Result<(), Error> {
        let params = json!({ "subscriptionId": subscription_id });
        self.ask(plugin, "events.unsubscribe", params).map(drop)
    }

    fn settings_get(
        &self,
        _plugin: &str,
        _key: &str,
        _owner: Option<&str>,
    ) -> Result<Option<Value>, Error> {
        Err(unsupported("settings.get"))
    }

    fn settings_set(&self, _plugin: &str, _key: &str, _value: Value) -> Result<(), Error> {
        Err(unsupported("settings.set"))
    }

    fn settings_list(&self, _plugin: &str, _others: bool) -> Result<Vec<Setting>, Error> {
        Err(unsupported("settings.list"))
    }

    fn log_write(
        &self,
        _plugin: &str,
        _level: LogLevel,
        _message: &str,
        _fields: Option<Value>,
    ) -> Result<(), Error> {
        Err(unsupported("log.write"))
    }

    fn log_tail(
        &self,
        _plugin: &str,
        _channel: Option<&str>,
        _count: Option<u32>,
    ) -> Result<Vec<LogEntry>, Error> {
        Err(unsupported("log.tail"))
    }
}

impl IndexSink for CoreHost {
    fn upsert(&self, items: &[Item]) -> Result<(), String> {
        let core = self.core().map_err(|e| e.message)?;
        let index = core.index().map_err(|e| e.message)?;
        index.upsert(items).map_err(|e| e.message)
    }

    fn remove(&self, source: &ItemSource, ids: &[String]) -> Result<(), String> {
        let core = self.core().map_err(|e| e.message)?;
        let index = core.index().map_err(|e| e.message)?;
        index.remove(source, ids).map(drop).map_err(|e| e.message)
    }

    fn clear(&self, source: &ItemSource) -> Result<(), String> {
        let core = self.core().map_err(|e| e.message)?;
        let index = core.index().map_err(|e| e.message)?;
        index.clear(source).map(drop).map_err(|e| e.message)
    }
}

/// A bridge grant as the WIT's: its id and its permission as JSON text.
fn grant(value: &Value) -> Grant {
    Grant {
        grant_id: value["grantId"].as_str().unwrap_or_default().to_owned(),
        permission: value["permission"].to_string(),
    }
}

/// A bridge error as the WIT's.
fn wit_error(e: BridgeError) -> Error {
    use desk_bridge::ErrorCode as Bridge;
    let code = match e.code {
        Bridge::PermissionDenied => ErrorCode::PermissionDenied,
        Bridge::InvalidParams => ErrorCode::InvalidParams,
        Bridge::NotFound => ErrorCode::NotFound,
        Bridge::AlreadyExists => ErrorCode::AlreadyExists,
        Bridge::IoError => ErrorCode::IoError,
        Bridge::Timeout => ErrorCode::Timeout,
        Bridge::Cancelled => ErrorCode::Cancelled,
        Bridge::Unsupported => ErrorCode::Unsupported,
        Bridge::Internal => ErrorCode::Internal,
    };
    Error {
        code,
        message: e.message,
    }
}

fn unsupported(method: &str) -> Error {
    Error {
        code: ErrorCode::Unsupported,
        message: format!("{method} is not served by the core yet"),
    }
}

fn internal(message: String) -> Error {
    Error {
        code: ErrorCode::Internal,
        message,
    }
}
