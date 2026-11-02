//! The test harness for Wasm plugins, which `desk plugin test` runs: each `tests/<name>.test.json`
//! of a logic plugin or a Wasm connector is a [`Case`] run on a fresh host whose desk is a script.
//! Every import the plugin makes is recorded as a bridge call (`{ method, params }`) and answered
//! from the case's `answers`; then the calls, and a connector's items, are checked against
//! `expect`. The file format is in `docs/plugins/authoring.md`.

mod answers;
mod expect;
mod scripted;

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use desk_bridge::{ConnectorState, ConnectorStatus, Item, ItemSource, PluginKind, PluginManifest};
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::clock::SystemClock;
use crate::connector::ConnectorHost;
use crate::limits::Limits;
use crate::logic::{LogicHost, PluginError};
use crate::sink::IndexSink;
use answers::Code;
use scripted::ScriptedHost;

/// One test: what happens, how the desk answers, and what must come of it.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Case {
    steps: Vec<Step>,
    #[serde(default)]
    answers: Vec<Answer>,
    #[serde(default)]
    expect: Expect,
}

/// One thing the desk does to the plugin, in order.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase", deny_unknown_fields)]
enum Step {
    /// A logic plugin's `start` export.
    Start,
    /// A logic plugin's `on-command`: an invocation of `id` (one of its commands) with `args`.
    Command {
        id: String,
        #[serde(default)]
        args: Value,
    },
    /// A logic plugin's `on-event`.
    Event {
        name: String,
        #[serde(default)]
        data: Value,
    },
    /// A connector's new instance with its settings, as `connector.connect` makes it.
    Connect {
        instance: String,
        #[serde(default)]
        settings: Value,
    },
    /// A connector instance's sync, at once.
    Sync { instance: String },
}

impl Step {
    fn name(&self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Command { .. } => "command",
            Self::Event { .. } => "event",
            Self::Connect { .. } => "connect",
            Self::Sync { .. } => "sync",
        }
    }
}

/// How the desk answers calls of `method` whose params contain `params`: with `result`, or
/// with `error`. The first answer that matches a call is used.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct Answer {
    method: String,
    #[serde(default)]
    params: Option<Value>,
    #[serde(default)]
    result: Value,
    #[serde(default)]
    error: Option<Refusal>,
}

/// A bridge error the script answers with: `not_found`, `permission_denied`, ...
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct Refusal {
    code: Code,
    #[serde(default)]
    message: String,
}

/// What must have happened: these calls in this order, and for a connector these items among
/// what its syncs brought, in this order. Others may come between; params and items match when
/// they contain what is written here.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct Expect {
    #[serde(default)]
    calls: Vec<Expected>,
    #[serde(default)]
    items: Vec<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct Expected {
    method: String,
    #[serde(default)]
    params: Option<Value>,
}

/// Run `case` on the Wasm plugin in `dir`: install it on a fresh host, take the steps, then check
/// what was expected. `Err` says what went wrong: a step that failed, an answer the script got
/// wrong, or what was expected and did not come, with what came instead.
pub fn run(dir: &Path, case: &Case) -> Result<(), String> {
    let manifest = manifest(dir)?;
    let host = Arc::new(ScriptedHost::new(case.answers.clone()));
    let sink = Arc::new(Recording::default());
    let ran = match manifest.kind {
        PluginKind::Logic => logic(dir, case, &host),
        PluginKind::Connector => connector(dir, case, &host, &sink),
        _ => Err(format!(
            "{} is not a logic plugin or a Wasm connector, which the harness runs",
            manifest.id
        )),
    };
    if let Some(problem) = host.problems().into_iter().next() {
        return Err(problem);
    }
    ran?;
    expect::calls(&case.expect.calls, &host.calls())?;
    expect::items(&case.expect.items, &sink.items())
}

/// One test's name (its file name without `.test.json`) and how it went.
pub type Ran = (String, Result<(), String>);

/// Run every `tests/*.test.json` of the plugin in `dir`, in name order. No `tests` folder means no
/// tests; `Err` is a `tests` folder that cannot be read.
pub fn run_folder(dir: &Path) -> Result<Vec<Ran>, String> {
    let folder = dir.join("tests");
    let mut files: Vec<PathBuf> = match fs::read_dir(&folder) {
        Ok(read) => read.flatten().map(|entry| entry.path()).collect(),
        Err(error) if error.kind() == ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(format!("{}: {error}", folder.display())),
    };
    files.retain(|file| file.is_file() && test_name(file).is_some());
    files.sort();
    let ran = files.iter().map(|file| {
        let name = test_name(file).unwrap_or_default();
        let outcome = fs::read_to_string(file)
            .map_err(|e| e.to_string())
            .and_then(|text| {
                serde_json::from_str::<Case>(&text)
                    .map_err(|e| format!("{name}.test.json is not a test case: {e}"))
            })
            .and_then(|case| run(dir, &case));
        (name, outcome)
    });
    Ok(ran.collect())
}

fn test_name(file: &Path) -> Option<String> {
    let name = file.file_name()?.to_str()?;
    Some(name.strip_suffix(".test.json")?.to_owned()).filter(|name| !name.is_empty())
}

fn manifest(dir: &Path) -> Result<PluginManifest, String> {
    let text = fs::read_to_string(dir.join("plugin.json"))
        .map_err(|e| format!("plugin.json cannot be read: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("plugin.json: {e}"))
}

fn failed(n: usize, step: &Step, error: PluginError) -> String {
    format!("steps[{n}] ({}): {error}", step.name())
}

fn logic(dir: &Path, case: &Case, host: &Arc<ScriptedHost>) -> Result<(), String> {
    let mut logic =
        LogicHost::new(Arc::clone(host) as _, Limits::default()).map_err(|e| e.to_string())?;
    let id = logic.install(dir).map_err(|e| e.to_string())?;
    for (n, step) in case.steps.iter().enumerate() {
        let done = match step {
            Step::Start => logic.start(&id),
            Step::Command { id: command, args } => {
                logic.deliver_command(&id, &format!("inv-{}", n + 1), command, args)
            }
            Step::Event { name, data } => logic.deliver_event(&id, name, data),
            Step::Connect { .. } | Step::Sync { .. } => {
                let kind = step.name();
                return Err(format!(
                    "steps[{n}] ({kind}): {kind} is a connector's step, and {id} is a logic plugin"
                ));
            }
        };
        done.map_err(|error| failed(n, step, error))?;
    }
    Ok(())
}

fn connector(
    dir: &Path,
    case: &Case,
    host: &Arc<ScriptedHost>,
    sink: &Arc<Recording>,
) -> Result<(), String> {
    let (host, sink) = (Arc::clone(host) as _, Arc::clone(sink) as _);
    let connectors = ConnectorHost::new(host, sink, Arc::new(SystemClock), Limits::default())
        .map_err(|e| e.to_string())?;
    let id = connectors.install(dir).map_err(|e| e.to_string())?;
    for (n, step) in case.steps.iter().enumerate() {
        let (instance, status) = match step {
            Step::Connect { instance, settings } => {
                let settings = match settings {
                    Value::Null => Value::Object(Map::new()),
                    settings => settings.clone(),
                };
                (
                    instance,
                    connectors.create_instance(&id, instance, settings),
                )
            }
            Step::Sync { instance } => (instance, connectors.sync_now(&id, instance)),
            Step::Start | Step::Command { .. } | Step::Event { .. } => {
                let kind = step.name();
                return Err(format!(
                    "steps[{n}] ({kind}): {kind} is a logic plugin's step, and {id} is a connector"
                ));
            }
        };
        let status = status.map_err(|error| failed(n, step, error))?;
        in_error(&status).map_or(Ok(()), |why| {
            let name = step.name();
            Err(format!(
                "steps[{n}] ({name}): {id}/{instance} is in error: {why}"
            ))
        })?;
    }
    Ok(())
}

fn in_error(status: &ConnectorStatus) -> Option<String> {
    let error = status.error.as_ref().map(|e| e.message.clone());
    (status.state == ConnectorState::Error).then(|| error.unwrap_or_default())
}

/// The index side of a connector's syncs: every item upserted, as JSON, in order.
#[derive(Default)]
struct Recording(Mutex<Vec<Value>>);

impl Recording {
    fn items(&self) -> Vec<Value> {
        self.0.lock().map(|items| items.clone()).unwrap_or_default()
    }
}

impl IndexSink for Recording {
    fn upsert(&self, items: &[Item]) -> Result<(), String> {
        let mut kept = self.0.lock().map_err(|e| e.to_string())?;
        for item in items {
            kept.push(serde_json::to_value(item).map_err(|e| e.to_string())?);
        }
        Ok(())
    }

    fn remove(&self, _source: &ItemSource, _ids: &[String]) -> Result<(), String> {
        Ok(())
    }

    fn clear(&self, _source: &ItemSource) -> Result<(), String> {
        Ok(())
    }
}
