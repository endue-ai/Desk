//! The tools: four that work with every plugin (list the plugins, list the commands, run a command,
//! call a bridge method), and a tool of its own for each command of the plugins `--plugin` names.
//! A command's tool is its id with dots as underscores (`endue.git.status` is `endue_git_status`):
//! command ids have no underscores, so the name maps back, and the four have none, so no command's
//! tool can take their names.

use serde_json::{Value, json};

use crate::catalog::Catalog;

pub const LIST_PLUGINS: &str = "list-plugins";
pub const LIST_COMMANDS: &str = "list-commands";
pub const RUN_COMMAND: &str = "run-command";
pub const CALL_BRIDGE: &str = "call-bridge";

/// The longest tool name MCP clients take (the Anthropic API's limit).
const MAX_NAME: usize = 64;

/// Which plugins' commands get a tool of their own: those `--plugin` named, every one for `*`, `desk`
/// for the runtime's own.
#[derive(Clone, Debug, Default)]
pub(crate) struct Selection(Vec<String>);

impl Selection {
    pub(crate) fn new(plugins: Vec<String>) -> Self {
        Self(plugins)
    }

    /// Whether any command can get a tool of its own, so the list of tools can change.
    pub(crate) fn any(&self) -> bool {
        !self.0.is_empty()
    }

    pub(crate) fn picks(&self, provider: &str) -> bool {
        self.0.iter().any(|p| p == "*" || p == provider)
    }

    /// The tool of `command` (a `cmd.list` entry) when its provider is picked and its name fits.
    pub(crate) fn tool_for(&self, command: &Value) -> Option<String> {
        let provider = command["provider"].as_str()?;
        self.picks(provider)
            .then(|| tool_name(command["id"].as_str()?))
            .flatten()
    }
}

/// A command's tool name: its id with dots as underscores, when it fits.
pub(crate) fn tool_name(command: &str) -> Option<String> {
    let name = command.replace('.', "_");
    (name.len() <= MAX_NAME && name.contains('_')).then_some(name)
}

/// The command id a tool name stands for, when it can be one.
pub(crate) fn command_of(tool: &str) -> Option<String> {
    let valid = tool.contains('_')
        && tool
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_');
    valid.then(|| tool.replace('_', "."))
}

/// `tools/list`: the four, then a tool for each picked command the catalog has.
pub(crate) fn list(selection: &Selection, catalog: Option<&Catalog>) -> Value {
    let mut tools = fixed(&agent_note());
    for command in catalog.map(Catalog::commands).unwrap_or_default() {
        let Some(name) = selection.tool_for(command) else {
            continue;
        };
        let irreversible = catalog.is_some_and(|c| c.irreversible(command));
        tools.push(command_tool(&name, command, irreversible));
    }
    json!({ "tools": tools })
}

fn agent_note() -> String {
    "It runs as this server's agent: the first time, Desk asks the person to allow it, and a command \
     its plugin marks irreversible waits for the person's approval."
        .to_owned()
}

fn fixed(note: &str) -> Vec<Value> {
    let plugin = json!({ "type": "string", "description": "A plugin id, such as endue.git" });
    vec![
        json!({
            "name": LIST_PLUGINS,
            "title": "List Desk plugins",
            "description": "List the plugins installed in the running endue Desk (id, name, kind, \
                description, whether it is enabled and ready) with the commands each one provides \
                now, and Desk's own commands under desk. Start here to see what Desk can do.",
            "inputSchema": {
                "type": "object",
                "properties": { "plugin": plugin },
                "additionalProperties": false
            },
            "annotations": { "title": "List Desk plugins", "readOnlyHint": true, "openWorldHint": false }
        }),
        json!({
            "name": LIST_COMMANDS,
            "title": "List Desk commands",
            "description": "List the commands the running Desk can run, from every plugin and from \
                Desk itself (provider desk): id, title, description, provider, keywords, the JSON \
                Schema of their args, and irreversible when the plugin says so. Filter by plugin \
                and by words.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "plugin": {
                        "type": "string",
                        "description": "Only the commands this plugin provides; desk for Desk's own"
                    },
                    "query": {
                        "type": "string",
                        "description": "Words every listed command has in its id, title, description or keywords"
                    }
                },
                "additionalProperties": false
            },
            "annotations": { "title": "List Desk commands", "readOnlyHint": true, "openWorldHint": false }
        }),
        json!({
            "name": RUN_COMMAND,
            "title": "Run a Desk command",
            "description": format!(
                "Run one Desk command by id, whichever plugin provides it, and return its result. \
                 Find commands with list-commands; args must match the command's argsSchema. {note}"
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The command id, such as endue.git.status",
                        "pattern": "^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)+$"
                    },
                    "args": { "type": "object", "description": "The command's args; leave out for none" }
                },
                "required": ["command"],
                "additionalProperties": false
            },
            "annotations": { "title": "Run a Desk command", "destructiveHint": true, "openWorldHint": true }
        }),
        json!({
            "name": CALL_BRIDGE,
            "title": "Call a Desk bridge method",
            "description": format!(
                "Call one method of the Desk bridge (specs/bridge/v0) by name with its params and \
                 return its result: data.query and data.get for the items connector plugins bring \
                 in (mail, events, tasks), catalog.get, fs.read, view.list and the rest. A call that \
                 reaches beyond the agent's own data carries its permission scope in params.scope. \
                 cmd.invoke waits for the command's answer. {note}"
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "method": { "type": "string", "description": "A bridge method, such as data.query" },
                    "params": { "type": "object", "description": "The method's params; {} when it takes none" }
                },
                "required": ["method"],
                "additionalProperties": false
            },
            "annotations": { "title": "Call a Desk bridge method", "destructiveHint": true, "openWorldHint": true }
        }),
    ]
}

/// The tool of one command: its title, its description, its provider, and its args schema as the
/// tool's input.
fn command_tool(name: &str, command: &Value, irreversible: bool) -> Value {
    let title = command["title"].as_str().unwrap_or(name);
    let mut description = match command["description"].as_str() {
        Some(description) => format!("{title}. {description}"),
        None => format!("{title}."),
    };
    description.push_str(&format!(
        " The Desk command {} of {}. {}",
        command["id"].as_str().unwrap_or_default(),
        command["provider"].as_str().unwrap_or_default(),
        agent_note()
    ));
    if irreversible {
        description.push_str(" This command is irreversible.");
    }
    json!({
        "name": name,
        "title": title,
        "description": description,
        "inputSchema": input_schema(command.get("argsSchema")),
        "annotations": {
            "title": title,
            "readOnlyHint": false,
            "destructiveHint": irreversible,
            "openWorldHint": true
        }
    })
}

/// A command's args schema as an MCP input schema, which is always an object's.
fn input_schema(args: Option<&Value>) -> Value {
    match args.and_then(Value::as_object) {
        Some(schema) => {
            let mut schema = schema.clone();
            schema.insert("type".to_owned(), json!("object"));
            Value::Object(schema)
        }
        None => json!({ "type": "object", "properties": {}, "additionalProperties": false }),
    }
}
