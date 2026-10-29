//! A mock `Host`: it records every call as (plugin, bridge method, main argument) and keeps what a
//! desk would keep (files, the store, commands, answers, settings, the log) in memory.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use desk_plugin_host::{Command, CommandInfo, Decision, DirEntry, Duration, EntryKind, Error};
use desk_plugin_host::{ErrorCode, Failure, Grant, Host, LogEntry, LogLevel, NotifyLevel};
use desk_plugin_host::{Request, Response, Setting};
use serde_json::{Value, json};

/// One call that reached the host: the plugin, the bridge method and its main argument.
pub type Call = (String, String, String);
/// One notification: the plugin, the title, the body and the level.
pub type Note = (String, String, Option<String>, NotifyLevel);
/// One `cmd.answer`: the plugin, the invocation id and the outcome.
pub type Answer = (String, String, Result<Value, Failure>);
/// One `log.write`: the plugin, the level, the message and the fields.
pub type Line = (String, LogLevel, String, Option<Value>);

#[derive(Default)]
pub struct MockHost {
    files: Mutex<BTreeMap<String, Vec<u8>>>,
    refused: Mutex<BTreeSet<String>>,
    calls: Mutex<Vec<Call>>,
    notes: Mutex<Vec<Note>>,
    store: Mutex<BTreeMap<(String, String), Value>>,
    registered: Mutex<Vec<(String, Command)>>,
    answers: Mutex<Vec<Answer>>,
    settings: Mutex<BTreeMap<(String, String), Value>>,
    lines: Mutex<Vec<Line>>,
    next_id: AtomicUsize,
}

impl MockHost {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn with_file(path: &str, content: &[u8]) -> Arc<Self> {
        let host = Self::default();
        host.files
            .lock()
            .unwrap()
            .insert(path.into(), content.into());
        Arc::new(host)
    }

    /// Answer `method` (for example "fs.read") with permission-denied from now on.
    pub fn refuse(&self, method: &str) {
        self.refused.lock().unwrap().insert(method.into());
    }

    pub fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }

    pub fn notes(&self) -> Vec<Note> {
        self.notes.lock().unwrap().clone()
    }

    pub fn stored(&self, plugin: &str, key: &str) -> Option<Value> {
        let store = self.store.lock().unwrap();
        store.get(&(plugin.to_owned(), key.to_owned())).cloned()
    }

    /// Every `cmd.register` the host saw, in order, with the plugin that made it.
    pub fn registered(&self) -> Vec<(String, Command)> {
        self.registered.lock().unwrap().clone()
    }

    pub fn answers(&self) -> Vec<Answer> {
        self.answers.lock().unwrap().clone()
    }

    pub fn lines(&self) -> Vec<Line> {
        self.lines.lock().unwrap().clone()
    }

    fn call(&self, plugin: &str, method: &str, arg: &str) -> Result<(), Error> {
        let call = (plugin.to_owned(), method.to_owned(), arg.to_owned());
        self.calls.lock().unwrap().push(call);
        if self.refused.lock().unwrap().contains(method) {
            return Err(Error {
                code: ErrorCode::PermissionDenied,
                message: format!("{method} is not granted"),
            });
        }
        Ok(())
    }

    /// A fresh id for an invocation or a subscription.
    fn fresh(&self, prefix: &str) -> String {
        format!("{prefix}-{}", self.next_id.fetch_add(1, Ordering::Relaxed) + 1)
    }
}

/// The level's WIT name.
pub fn level_name(level: LogLevel) -> &'static str {
    match level {
        LogLevel::Debug => "debug",
        LogLevel::Info => "info",
        LogLevel::Warn => "warn",
        LogLevel::Error => "error",
    }
}

impl Host for MockHost {
    fn fs_read(&self, plugin: &str, path: &str) -> Result<Vec<u8>, Error> {
        self.call(plugin, "fs.read", path)?;
        self.files.lock().unwrap().get(path).cloned().ok_or(Error {
            code: ErrorCode::NotFound,
            message: format!("{path} does not exist"),
        })
    }

    fn fs_list(&self, plugin: &str, path: &str) -> Result<Vec<DirEntry>, Error> {
        self.call(plugin, "fs.list", path)?;
        Ok(vec![DirEntry {
            name: "hello.txt".into(),
            kind: EntryKind::File,
            size: Some(5),
        }])
    }

    fn fs_write(
        &self,
        plugin: &str,
        path: &str,
        contents: &[u8],
        create_dirs: bool,
    ) -> Result<u64, Error> {
        let arg = format!("{path} create_dirs={create_dirs}");
        self.call(plugin, "fs.write", &arg)?;
        let mut files = self.files.lock().unwrap();
        files.insert(path.into(), contents.into());
        Ok(contents.len() as u64)
    }

    fn net_fetch(&self, plugin: &str, request: Request) -> Result<Response, Error> {
        let arg = format!("{} {}", request.method, request.url);
        self.call(plugin, "net.fetch", &arg)?;
        Ok(Response {
            status: 200,
            headers: vec![("content-type".into(), "text/plain".into())],
            body: b"ok".to_vec(),
        })
    }

    fn ui_notify(
        &self,
        plugin: &str,
        title: &str,
        body: Option<&str>,
        level: NotifyLevel,
    ) -> Result<(), Error> {
        self.call(plugin, "ui.notify", title)?;
        let note = (plugin.into(), title.into(), body.map(str::to_owned), level);
        self.notes.lock().unwrap().push(note);
        Ok(())
    }

    fn perm_query(&self, plugin: &str) -> Vec<Grant> {
        let _ = self.call(plugin, "perm.query", "");
        vec![Grant {
            grant_id: "g1".into(),
            permission: json!({ "permission": "ui:notify" }).to_string(),
        }]
    }

    fn perm_request(
        &self,
        plugin: &str,
        permission: Value,
        reason: &str,
        duration: Option<Duration>,
    ) -> Result<Decision, Error> {
        let name = permission["permission"].as_str().unwrap_or("?");
        let duration = match duration.unwrap_or(Duration::Session) {
            Duration::Once => "once",
            Duration::Session => "session",
            Duration::Always => "always",
        };
        self.call(plugin, "perm.request", &format!("{name} {duration}: {reason}"))?;
        let grant = Grant {
            grant_id: self.fresh("g"),
            permission: permission.to_string(),
        };
        Ok(Decision {
            granted: true,
            grant: Some(grant),
        })
    }

    fn store_get(&self, plugin: &str, key: &str) -> Result<Option<Value>, Error> {
        self.call(plugin, "store.get", key)?;
        Ok(self.stored(plugin, key))
    }

    fn store_set(&self, plugin: &str, key: &str, value: Value) -> Result<(), Error> {
        self.call(plugin, "store.set", key)?;
        let mut store = self.store.lock().unwrap();
        store.insert((plugin.to_owned(), key.to_owned()), value);
        Ok(())
    }

    fn cmd_register(&self, plugin: &str, command: Command) -> Result<(), Error> {
        self.call(plugin, "cmd.register", &command.id)?;
        self.registered.lock().unwrap().push((plugin.into(), command));
        Ok(())
    }

    fn cmd_unregister(&self, plugin: &str, id: &str) -> Result<(), Error> {
        self.call(plugin, "cmd.unregister", id)
    }

    fn cmd_list(&self, plugin: &str) -> Result<Vec<CommandInfo>, Error> {
        self.call(plugin, "cmd.list", "")?;
        let registered = self.registered.lock().unwrap();
        let info = registered.iter().map(|(provider, command)| CommandInfo {
            command: command.clone(),
            provider: provider.clone(),
        });
        Ok(info.collect())
    }

    fn cmd_invoke(&self, plugin: &str, id: &str, args: Option<Value>) -> Result<String, Error> {
        let args = args.map(|args| args.to_string()).unwrap_or_default();
        self.call(plugin, "cmd.invoke", &format!("{id} {args}"))?;
        Ok(self.fresh("inv"))
    }

    fn cmd_answer(
        &self,
        plugin: &str,
        invocation_id: &str,
        outcome: Result<Value, Failure>,
    ) -> Result<(), Error> {
        let arg = match &outcome {
            Ok(result) => format!("{invocation_id} ok {result}"),
            Err(failure) => format!("{invocation_id} failed {}", failure.message),
        };
        self.call(plugin, "cmd.answer", &arg)?;
        let answer = (plugin.to_owned(), invocation_id.to_owned(), outcome);
        self.answers.lock().unwrap().push(answer);
        Ok(())
    }

    fn events_subscribe(&self, plugin: &str, names: &[String]) -> Result<String, Error> {
        self.call(plugin, "events.subscribe", &names.join(","))?;
        Ok(self.fresh("sub"))
    }

    fn events_unsubscribe(&self, plugin: &str, subscription_id: &str) -> Result<(), Error> {
        self.call(plugin, "events.unsubscribe", subscription_id)
    }

    fn settings_get(
        &self,
        plugin: &str,
        key: &str,
        owner: Option<&str>,
    ) -> Result<Option<Value>, Error> {
        let owner = owner.unwrap_or(plugin);
        self.call(plugin, "settings.get", &format!("{owner}/{key}"))?;
        let settings = self.settings.lock().unwrap();
        Ok(settings.get(&(owner.to_owned(), key.to_owned())).cloned())
    }

    fn settings_set(&self, plugin: &str, key: &str, value: Value) -> Result<(), Error> {
        self.call(plugin, "settings.set", &format!("{key} {value}"))?;
        let mut settings = self.settings.lock().unwrap();
        settings.insert((plugin.to_owned(), key.to_owned()), value);
        Ok(())
    }

    fn settings_list(&self, plugin: &str, others: bool) -> Result<Vec<Setting>, Error> {
        self.call(plugin, "settings.list", &format!("others={others}"))?;
        let settings = self.settings.lock().unwrap();
        let listed = settings
            .iter()
            .filter(|((owner, _), _)| others || owner == plugin)
            .map(|((owner, key), value)| Setting {
                owner: owner.clone(),
                key: key.clone(),
                value: value.to_string(),
            });
        Ok(listed.collect())
    }

    fn log_write(
        &self,
        plugin: &str,
        level: LogLevel,
        message: &str,
        fields: Option<Value>,
    ) -> Result<(), Error> {
        let arg = format!("{} {message}", level_name(level));
        self.call(plugin, "log.write", &arg)?;
        let line = (plugin.to_owned(), level, message.to_owned(), fields);
        self.lines.lock().unwrap().push(line);
        Ok(())
    }

    fn log_tail(
        &self,
        plugin: &str,
        channel: Option<&str>,
        count: Option<u32>,
    ) -> Result<Vec<LogEntry>, Error> {
        let count = count.unwrap_or(100);
        let arg = format!("{} {count}", channel.unwrap_or("*"));
        self.call(plugin, "log.tail", &arg)?;
        let lines = self.lines.lock().unwrap();
        let entries: Vec<LogEntry> = lines
            .iter()
            .filter(|line| channel.is_none_or(|channel| line.0 == channel))
            .map(|(channel, level, message, fields)| LogEntry {
                at: "2026-01-01T00:00:00Z".into(),
                channel: channel.clone(),
                level: *level,
                message: message.clone(),
                fields: fields.as_ref().map(Value::to_string),
            })
            .collect();
        let skip = entries.len().saturating_sub(count as usize);
        Ok(entries.into_iter().skip(skip).collect())
    }
}
