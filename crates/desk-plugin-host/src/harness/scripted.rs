//! The desk as a script: a `Host` that records every import as a bridge call and answers it with
//! the first of the case's answers that matches, or else with the empty answer. The plugin's store
//! is kept in memory, so `store.get` returns what the plugin set in the same case.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard};

use serde_json::{Map, Value, json};

use super::answers;
use super::expect::contains;
use super::{Answer, Refusal};
use crate::bindings::{Command, CommandInfo, Decision, DirEntry, Duration, Error, ErrorCode};
use crate::bindings::{Failure, FailureCode, Grant, LogEntry, LogLevel, NotifyLevel};
use crate::bindings::{Request, Response, Setting};
use crate::host::Host;
use crate::imports::RESERVED;

/// One import the plugin made, as the bridge names it.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Call {
    pub(super) method: String,
    pub(super) params: Value,
}

pub(super) struct ScriptedHost {
    answers: Vec<Answer>,
    calls: Mutex<Vec<Call>>,
    store: Mutex<BTreeMap<String, Value>>,
    problems: Mutex<Vec<String>>,
    next: AtomicUsize,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn refused(code: ErrorCode, message: String) -> Error {
    Error { code, message }
}

/// What a method answers when the script says nothing: `not-found` for a file and `unsupported`
/// for the network, which a test must script.
fn unscripted(method: &str, code: ErrorCode) -> Error {
    refused(code, format!("the test scripts no answer to {method}"))
}

/// `params` without the keys whose value is `None` (JSON null).
fn params(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            Value::Object(map.into_iter().filter(|(_, v)| !v.is_null()).collect())
        }
        other => other,
    }
}

impl ScriptedHost {
    pub(super) fn new(answers: Vec<Answer>) -> Self {
        Self {
            answers,
            calls: Mutex::default(),
            store: Mutex::default(),
            problems: Mutex::default(),
            next: AtomicUsize::new(0),
        }
    }

    pub(super) fn calls(&self) -> Vec<Call> {
        lock(&self.calls).clone()
    }

    /// Answers the script got wrong, as messages.
    pub(super) fn problems(&self) -> Vec<String> {
        lock(&self.problems).clone()
    }

    fn fresh(&self, prefix: &str) -> String {
        format!("{prefix}-{}", self.next.fetch_add(1, Ordering::Relaxed) + 1)
    }

    /// Record the call, then answer it: the script's first matching answer read by `read`, or
    /// `otherwise` when none matches.
    fn answer<T>(
        &self,
        method: &str,
        params: Value,
        read: impl FnOnce(Value) -> Result<T, String>,
        otherwise: impl FnOnce() -> Result<T, Error>,
    ) -> Result<T, Error> {
        let call = Call {
            method: method.to_owned(),
            params: self::params(params),
        };
        let scripted = self.answers.iter().find(|answer| {
            answer.method == method
                && answer
                    .params
                    .as_ref()
                    .is_none_or(|wanted| contains(&call.params, wanted))
        });
        lock(&self.calls).push(call);
        let Some(answer) = scripted else {
            return otherwise();
        };
        if let Some(Refusal { code, message }) = &answer.error {
            return Err(refused(code.wit(), message.clone()));
        }
        read(answer.result.clone()).map_err(|why| {
            let problem = format!("the test's answer to {method} does not fit: {why}");
            lock(&self.problems).push(problem.clone());
            refused(ErrorCode::Internal, problem)
        })
    }

    fn done(&self, method: &str, params: Value) -> Result<(), Error> {
        self.answer(method, params, |_| Ok(()), || Ok(()))
    }
}

impl Host for ScriptedHost {
    fn fs_read(&self, _plugin: &str, path: &str) -> Result<Vec<u8>, Error> {
        let missing = || Err(unscripted("fs.read", ErrorCode::NotFound));
        self.answer("fs.read", json!({ "path": path }), answers::bytes, missing)
    }

    fn fs_list(&self, _plugin: &str, path: &str) -> Result<Vec<DirEntry>, Error> {
        let missing = || Err(unscripted("fs.list", ErrorCode::NotFound));
        self.answer(
            "fs.list",
            json!({ "path": path }),
            answers::entries,
            missing,
        )
    }

    fn fs_write(&self, _: &str, path: &str, contents: &[u8], create: bool) -> Result<u64, Error> {
        let text = String::from_utf8_lossy(contents);
        let params = json!({ "path": path, "content": text, "createDirs": create });
        self.answer("fs.write", params, answers::count, || {
            Ok(contents.len() as u64)
        })
    }

    fn net_fetch(&self, _plugin: &str, request: Request) -> Result<Response, Error> {
        let headers: Map<String, Value> = request
            .headers
            .into_iter()
            .map(|(name, value)| (name, Value::String(value)))
            .collect();
        let body = request
            .body
            .map(|body| String::from_utf8_lossy(&body).into_owned());
        let params = json!({
            "url": request.url, "method": request.method, "headers": headers, "body": body,
        });
        let missing = || Err(unscripted("net.fetch", ErrorCode::Unsupported));
        self.answer("net.fetch", params, answers::response, missing)
    }

    fn ui_notify(
        &self,
        _plugin: &str,
        title: &str,
        body: Option<&str>,
        level: NotifyLevel,
    ) -> Result<(), Error> {
        let level = answers::notify_level(level);
        let params = json!({ "title": title, "body": body, "level": level });
        self.done("ui.notify", params)
    }

    fn perm_query(&self, _plugin: &str) -> Vec<Grant> {
        let answer = self.answer("perm.query", json!({}), answers::grants, || Ok(vec![]));
        answer.unwrap_or_default()
    }

    fn perm_request(
        &self,
        _plugin: &str,
        permission: Value,
        reason: &str,
        duration: Option<Duration>,
    ) -> Result<Decision, Error> {
        let duration = duration.map(answers::duration);
        let params = json!({ "permission": permission, "reason": reason, "duration": duration });
        // Unscripted, the person says no.
        let no = || {
            Ok(Decision {
                granted: false,
                grant: None,
            })
        };
        self.answer("perm.request", params, answers::decision, no)
    }

    fn store_get(&self, _plugin: &str, key: &str) -> Result<Option<Value>, Error> {
        let kept = lock(&self.store).get(key).cloned();
        if key.starts_with(RESERVED) {
            // The host's own keys (a connector's instances and cursors) are not the plugin's calls.
            return Ok(kept);
        }
        let params = json!({ "key": key });
        self.answer("store.get", params, answers::optional, || Ok(kept))
    }

    fn store_set(&self, _plugin: &str, key: &str, value: Value) -> Result<(), Error> {
        lock(&self.store).insert(key.to_owned(), value.clone());
        if key.starts_with(RESERVED) {
            return Ok(());
        }
        self.done("store.set", json!({ "key": key, "value": value }))
    }

    fn cmd_register(&self, _plugin: &str, command: Command) -> Result<(), Error> {
        let schema = command
            .args_schema
            .and_then(|schema| serde_json::from_str::<Value>(&schema).ok());
        let params = json!({
            "id": command.id, "title": command.title, "description": command.description,
            "keywords": command.keywords, "argsSchema": schema, "when": command.when,
        });
        self.done("cmd.register", params)
    }

    fn cmd_unregister(&self, _plugin: &str, id: &str) -> Result<(), Error> {
        self.done("cmd.unregister", json!({ "id": id }))
    }

    fn cmd_list(&self, _plugin: &str) -> Result<Vec<CommandInfo>, Error> {
        self.answer("cmd.list", json!({}), answers::commands, || Ok(vec![]))
    }

    fn cmd_invoke(&self, _plugin: &str, id: &str, args: Option<Value>) -> Result<String, Error> {
        let params = json!({ "id": id, "args": args });
        self.answer("cmd.invoke", params, answers::id, || Ok(self.fresh("inv")))
    }

    fn cmd_answer(
        &self,
        _plugin: &str,
        invocation_id: &str,
        outcome: Result<Value, Failure>,
    ) -> Result<(), Error> {
        let params = match outcome {
            Ok(result) => json!({ "invocationId": invocation_id, "result": result }),
            Err(failure) => {
                let code = match failure.code {
                    FailureCode::Failed => "failed",
                    FailureCode::Cancelled => "cancelled",
                };
                let error = json!({ "code": code, "message": failure.message });
                json!({ "invocationId": invocation_id, "error": error })
            }
        };
        self.done("cmd.answer", params)
    }

    fn events_subscribe(&self, _plugin: &str, names: &[String]) -> Result<String, Error> {
        let params = json!({ "names": names });
        self.answer("events.subscribe", params, answers::id, || {
            Ok(self.fresh("sub"))
        })
    }

    fn events_unsubscribe(&self, _plugin: &str, subscription_id: &str) -> Result<(), Error> {
        let params = json!({ "subscriptionId": subscription_id });
        self.done("events.unsubscribe", params)
    }

    fn settings_get(
        &self,
        _plugin: &str,
        key: &str,
        owner: Option<&str>,
    ) -> Result<Option<Value>, Error> {
        let params = json!({ "key": key, "owner": owner });
        self.answer("settings.get", params, answers::optional, || Ok(None))
    }

    fn settings_set(&self, _plugin: &str, key: &str, value: Value) -> Result<(), Error> {
        self.done("settings.set", json!({ "key": key, "value": value }))
    }

    fn settings_list(&self, _plugin: &str, others: bool) -> Result<Vec<Setting>, Error> {
        let params = json!({ "others": others });
        self.answer("settings.list", params, answers::settings, || Ok(vec![]))
    }

    fn log_write(
        &self,
        _plugin: &str,
        level: LogLevel,
        message: &str,
        fields: Option<Value>,
    ) -> Result<(), Error> {
        let level = answers::level(level);
        let params = json!({ "level": level, "message": message, "fields": fields });
        self.done("log.write", params)
    }

    fn log_tail(
        &self,
        _plugin: &str,
        channel: Option<&str>,
        count: Option<u32>,
    ) -> Result<Vec<LogEntry>, Error> {
        let params = json!({ "channel": channel, "count": count });
        self.answer("log.tail", params, answers::lines, || Ok(vec![]))
    }
}
