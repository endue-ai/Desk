//! What the desk has: its installed plugins and the commands registered now, read as `cli` with
//! `plugin.list` and `cmd.list`. Reading is not acting: the MCP client sees every plugin and command
//! the desk has, and running one is the agent's call (ADR 0086).

use serde_json::{Map, Value, json};

use crate::desk::{Desk, Failure};
use crate::tools::Selection;

/// The provider of the commands no plugin provides: the web runtime.
pub(crate) const RUNTIME: &str = "desk";

pub(crate) struct Catalog {
    plugins: Vec<Value>,
    commands: Vec<Value>,
}

impl Catalog {
    pub(crate) fn read(desk: &Desk) -> Result<Self, Failure> {
        let mut conn = desk.cli()?;
        let plugins = conn.call(
            "plugin.list",
            json!({ "scope": { "permission": "plugin:manage" } }),
        )?;
        let commands = conn.call(
            "cmd.list",
            json!({ "scope": { "permission": "cmd:invoke", "ids": ["*"] } }),
        )?;
        let list = |value: &Value, key: &str| value[key].as_array().cloned().unwrap_or_default();
        Ok(Self {
            plugins: list(&plugins, "plugins"),
            commands: list(&commands, "commands"),
        })
    }

    /// The installed plugins, as `plugin.list` answers them.
    pub(crate) fn plugins(&self) -> &[Value] {
        &self.plugins
    }

    /// The registered commands, in registration order.
    pub(crate) fn commands(&self) -> &[Value] {
        &self.commands
    }

    /// The installed plugin `id`.
    pub(crate) fn plugin(&self, id: &str) -> Option<&Value> {
        self.plugins.iter().find(|plugin| plugin["id"] == id)
    }

    /// Whether the provider's manifest marks the command `irreversible` (ADR 0078).
    pub(crate) fn irreversible(&self, command: &Value) -> bool {
        let Some(provider) = command["provider"].as_str().and_then(|p| self.plugin(p)) else {
            return false;
        };
        let declared = provider["manifest"]["contributes"]["commands"].as_array();
        declared
            .into_iter()
            .flatten()
            .any(|c| c["id"] == command["id"] && c["irreversible"] == true)
    }

    /// `list-plugins`: every plugin (or only `only`) with the commands it provides now, and the
    /// runtime's own commands under `desk`. `None` when `only` is not installed.
    pub(crate) fn plugins_json(&self, only: Option<&str>, tools: &Selection) -> Option<Value> {
        let picked: Vec<&Value> = self
            .plugins
            .iter()
            .filter(|p| only.is_none_or(|id| p["id"] == id))
            .collect();
        if only.is_some() && picked.is_empty() && only != Some(RUNTIME) {
            return None;
        }
        let plugins: Vec<Value> = picked
            .into_iter()
            .map(|plugin| self.summary(plugin, tools))
            .collect();
        let mut answer = json!({ "plugins": plugins });
        if only.is_none_or(|id| id == RUNTIME) {
            answer[RUNTIME] = json!({ "commands": self.brief(RUNTIME, tools) });
        }
        Some(answer)
    }

    /// One plugin as its resource reads: the summary and its whole manifest.
    pub(crate) fn plugin_json(&self, id: &str, tools: &Selection) -> Option<Value> {
        let plugin = self.plugin(id)?;
        let mut answer = self.summary(plugin, tools);
        answer["manifest"] = plugin["manifest"].clone();
        Some(answer)
    }

    /// `list-commands`: the commands `plugin` provides (all without it) whose id, title,
    /// description or keywords hold every word of `query`, with their args schema.
    pub(crate) fn commands_json(
        &self,
        plugin: Option<&str>,
        query: Option<&str>,
        tools: &Selection,
    ) -> Value {
        let words: Vec<String> = query
            .unwrap_or_default()
            .split_whitespace()
            .map(str::to_lowercase)
            .collect();
        let commands: Vec<Value> = self
            .commands
            .iter()
            .filter(|c| plugin.is_none_or(|p| c["provider"] == p))
            .filter(|c| {
                let text = searchable(c);
                words.iter().all(|word| text.contains(word))
            })
            .map(|c| self.command_json(c, tools))
            .collect();
        json!({ "commands": commands })
    }

    fn command_json(&self, command: &Value, tools: &Selection) -> Value {
        let mut out = Map::new();
        for key in [
            "id",
            "title",
            "description",
            "provider",
            "keywords",
            "argsSchema",
        ] {
            if let Some(value) = command.get(key) {
                out.insert(key.to_owned(), value.clone());
            }
        }
        if self.irreversible(command) {
            out.insert("irreversible".to_owned(), json!(true));
        }
        if let Some(tool) = tools.tool_for(command) {
            out.insert("tool".to_owned(), json!(tool));
        }
        Value::Object(out)
    }

    fn summary(&self, plugin: &Value, tools: &Selection) -> Value {
        let manifest = &plugin["manifest"];
        let id = plugin["id"].as_str().unwrap_or_default();
        let mut out = json!({
            "id": id,
            "name": manifest.get("name").unwrap_or(&plugin["id"]),
            "kind": manifest["kind"],
            "enabled": plugin["enabled"],
            "status": plugin["status"],
            "builtIn": plugin["builtIn"],
            "commands": self.brief(id, tools),
        });
        if let Some(description) = manifest.get("description") {
            out["description"] = description.clone();
        }
        if let Some(error) = plugin.get("error") {
            out["error"] = error.clone();
        }
        out
    }

    /// The commands `provider` provides now: id, title and the tool of its own, if any.
    fn brief(&self, provider: &str, tools: &Selection) -> Vec<Value> {
        self.commands
            .iter()
            .filter(|c| c["provider"] == provider)
            .map(|c| {
                let mut brief = json!({ "id": c["id"], "title": c["title"] });
                if let Some(tool) = tools.tool_for(c) {
                    brief["tool"] = json!(tool);
                }
                brief
            })
            .collect()
    }
}

fn searchable(command: &Value) -> String {
    let mut text = String::new();
    for key in ["id", "title", "description", "provider"] {
        text.push_str(command[key].as_str().unwrap_or_default());
        text.push(' ');
    }
    for keyword in command["keywords"].as_array().into_iter().flatten() {
        text.push_str(keyword.as_str().unwrap_or_default());
        text.push(' ');
    }
    text.to_lowercase()
}
