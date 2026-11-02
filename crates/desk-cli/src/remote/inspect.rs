//! `desk inspect [section]` (#334): what the inspector plugin's Export JSON gives, made the same way
//! (`plugins/inspector/ui/sections.js`): the core's `cmd.recent`, `perm.list`, `plugin.list` and
//! `plugin.stats`, and the runtime's `desk.inspect.open` for the render tree, the surfaces and the
//! settings. Printed with two spaces and keys in the order JavaScript gives a sorted object, so the
//! text is the plugin's byte for byte (the golden pair in `plugins/inspector/tests/golden/`).

use std::cmp::Ordering;
use std::process::ExitCode;

use serde_json::{Map, Value, json};

use super::{Problem, Session, out};
use crate::args::SECTIONS;

/// The runtime's command for what only it knows.
const INSPECT: &str = "desk.inspect.open";

impl Session {
    /// Every section, or `only`; the first that fails ends it with nothing printed.
    pub(super) fn inspect(&mut self, only: Option<&'static str>) -> Result<ExitCode, Problem> {
        let mut sections = Map::new();
        for section in only.map_or(SECTIONS.to_vec(), |section| vec![section]) {
            match self.section(section)? {
                Ok(data) => {
                    sections.insert(section.to_owned(), data);
                }
                Err((code, message)) => {
                    eprintln!("desk: {code}: {message}");
                    return Ok(ExitCode::from(1));
                }
            }
        }
        let mut text = String::new();
        pretty(&Value::Object(sections), 0, &mut text);
        out(&text);
        Ok(ExitCode::SUCCESS)
    }

    /// One section's data, or the failure's code and message.
    fn section(&mut self, section: &str) -> Result<Result<Value, (String, String)>, Problem> {
        let manage = json!({ "scope": { "permission": "perm:manage" } });
        let plugins = json!({ "scope": { "permission": "plugin:manage" } });
        Ok(match section {
            "commands" => self
                .call("cmd.recent", manage)?
                .result
                .map(|r| r["invocations"].clone()),
            "grants" => self
                .call("perm.list", manage)?
                .result
                .map(|r| r["grants"].clone()),
            "plugins" => self.call("plugin.list", plugins)?.result.map(|r| {
                let listed = r["plugins"]
                    .as_array()
                    .map(Vec::as_slice)
                    .unwrap_or_default();
                Value::Array(listed.iter().map(plugin_state).collect())
            }),
            "calls" => self.call("plugin.stats", manage)?.result,
            _ => {
                let args = json!({ "section": section });
                self.invoke_and_wait(INSPECT, args.as_object().cloned())?
                    .result
            }
        })
    }
}

/// A plugin and its state, as the plugin's `pluginState` makes it: on or off, autoload, and
/// `quarantined` or `notResponding` only when plugin.list carries them.
fn plugin_state(info: &Value) -> Value {
    let manifest = &info["manifest"];
    let mut state = Map::new();
    state.insert("id".to_owned(), info["id"].clone());
    for key in ["name", "kind", "version"] {
        if let Some(value) = manifest[key].as_str().filter(|value| !value.is_empty()) {
            state.insert(key.to_owned(), value.into());
        }
    }
    let on = if info["enabled"] == true { "on" } else { "off" };
    state.insert("state".to_owned(), on.into());
    state.insert("autoload".to_owned(), (manifest["autoload"] == true).into());
    for key in ["builtIn", "status"] {
        if let Some(value) = info.get(key) {
            state.insert(key.to_owned(), value.clone());
        }
    }
    if let Some(error) = info["error"].as_str().filter(|error| !error.is_empty()) {
        state.insert("error".to_owned(), error.into());
    }
    for key in ["quarantined", "notResponding"] {
        if let Some(value) = info.get(key) {
            state.insert(key.to_owned(), value.clone());
        }
    }
    Value::Object(state)
}

/// `value` as `JSON.stringify(sortKeys(value), null, 2)` writes it.
fn pretty(value: &Value, depth: usize, text: &mut String) {
    let open = |text: &mut String, i: usize| {
        text.push_str(if i == 0 { "\n" } else { ",\n" });
        text.push_str(&"  ".repeat(depth + 1));
    };
    let close = |text: &mut String, end: char| {
        text.push('\n');
        text.push_str(&"  ".repeat(depth));
        text.push(end);
    };
    match value {
        Value::Array(items) if !items.is_empty() => {
            text.push('[');
            for (i, item) in items.iter().enumerate() {
                open(text, i);
                pretty(item, depth + 1, text);
            }
            close(text, ']');
        }
        Value::Object(map) if !map.is_empty() => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by(|a, b| js_order(a, b));
            text.push('{');
            for (i, key) in keys.into_iter().enumerate() {
                open(text, i);
                text.push_str(&Value::String(key.clone()).to_string());
                text.push_str(": ");
                pretty(&map[key], depth + 1, text);
            }
            close(text, '}');
        }
        other => text.push_str(&other.to_string()),
    }
}

/// The order of a sorted object's keys in JavaScript: array indices first, by number, then the
/// others by UTF-16 code units, as `Object.keys().sort()` and `Object.fromEntries` leave them.
fn js_order(a: &str, b: &str) -> Ordering {
    match (index(a), index(b)) {
        (Some(a), Some(b)) => a.cmp(&b),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => a.encode_utf16().cmp(b.encode_utf16()),
    }
}

/// A key JavaScript reads as an array index: a canonical integer below 2^32 - 1.
fn index(key: &str) -> Option<u32> {
    let n: u32 = key.parse().ok()?;
    (n != u32::MAX && n.to_string() == key).then_some(n)
}
