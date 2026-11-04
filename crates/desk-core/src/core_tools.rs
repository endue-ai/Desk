//! Commands as agents' tools (ADR 0084). A registration takes what it leaves out from the
//! provider's manifest (`described`): the description, the args and result schemas, `agent`,
//! `readOnly`, the undo and `irreversible`. Commands marked `agent` are the desk's tools: cmd.tools
//! lists them for a caller (an agent sees those its allowlist could let it run, anyone else those
//! its grants cover), and the desk's brain turns offer them (`offer`) with two tools of the desk's
//! own: desk-tools, which answers cmd.tools, and desk-run, which runs a command by id. A tool's
//! name is its command id with every dot an underscore; command ids hold no underscores, so the
//! name gives the id back, and the desk's two names, with no underscore, are never a command's.

use desk_brain::ToolDefinition;
use desk_bridge::{
    BridgeError, CmdInvokePermission, CmdRegisterParams, CmdToolsParams, CmdToolsResult,
    CommandContribution, CommandInfo, CommandTool, ErrorCode, Permission,
};
use serde_json::{Map, Value, json};

use crate::agents::agent_of;
use crate::handler::{Answer, Core, error, json};
use crate::perm::{Target, covers};

/// The tool that lists the desk's tools (cmd.tools).
pub(crate) const DESK_TOOLS: &str = "desk-tools";
/// The tool that runs one of the desk's commands by id.
pub(crate) const DESK_RUN: &str = "desk-run";
/// The most tools one brain turn offers (`specs/brain/v0`, `TurnRequest.tools`).
const TURN_TOOLS: usize = 32;
/// The longest tool name a brain turn takes.
const NAME_MAX: usize = 64;
/// How many tools cmd.tools answers when the call names no limit.
const LIMIT: u64 = 50;

impl Core {
    /// The command a cmd.register of `caller` makes: the call's fields, else what the caller's
    /// manifest declares for the id. `irreversible` is only ever the manifest's (ADR 0078). An
    /// agent command needs a description, and an irreversible one is never read-only.
    pub(crate) fn described(
        &self,
        caller: &str,
        params: CmdRegisterParams,
    ) -> Result<CommandInfo, BridgeError> {
        let declared = self.declared(caller, &params.id);
        let declared = declared.as_ref();
        let field = |pick: fn(&CommandContribution) -> Option<bool>| declared.and_then(pick);
        let irreversible = field(|c| c.irreversible) == Some(true);
        let info = CommandInfo {
            description: params
                .description
                .filter(|d| !d.is_empty())
                .or_else(|| declared.and_then(|c| c.description.clone())),
            args_schema: params
                .args_schema
                .or_else(|| declared.and_then(|c| c.args.clone())),
            result_schema: params
                .result_schema
                .or_else(|| declared.and_then(|c| c.result.clone())),
            undo: params
                .undo
                .or_else(|| declared.and_then(|c| c.undo.clone())),
            agent: params.agent.or(field(|c| c.agent)).filter(|on| *on),
            read_only: params.read_only.or(field(|c| c.read_only)).filter(|on| *on),
            irreversible: irreversible.then_some(true),
            id: params.id,
            title: params.title,
            keywords: params.keywords,
            when: params.when,
            provider: caller.to_owned(),
        };
        if info.agent.is_some() && info.description.is_none() {
            let why = format!(
                "{} is offered to agents, so it needs a description",
                info.id
            );
            return Err(error(ErrorCode::InvalidParams, why));
        }
        if info.read_only.is_some() && irreversible {
            let why = format!("{} is irreversible, so it cannot be read-only", info.id);
            return Err(error(ErrorCode::InvalidParams, why));
        }
        Ok(info)
    }

    pub(crate) fn cmd_tools(&self, caller: &str, params: CmdToolsParams) -> Answer {
        let limit = usize::try_from(params.limit.unwrap_or(LIMIT).min(200)).unwrap_or(200);
        let query = params.query.unwrap_or_default().to_lowercase();
        let words: Vec<&str> = query.split_whitespace().collect();
        let allow = agent_of(caller).map(|agent| self.allowlist(agent));
        let tools = self
            .agent_commands()
            .into_iter()
            .filter(|info| matches(info, &words))
            .filter_map(|info| self.tool_for(caller, allow.as_deref(), info))
            .take(limit)
            .collect();
        json(CmdToolsResult { tools })
    }

    /// The registered commands marked `agent`, in registration order.
    pub(crate) fn agent_commands(&self) -> Vec<CommandInfo> {
        let registered = self.registered().into_iter();
        registered.filter(|c| c.agent == Some(true)).collect()
    }

    /// The registered command a tool call names: by its id, or by its tool name.
    pub(crate) fn command_named(&self, name: &str) -> Option<String> {
        [name.to_owned(), name.replace('_', ".")]
            .into_iter()
            .find(|id| self.command(id).is_some())
    }

    /// The tools the desk's brain turns offer: none without agent commands; else desk-tools and
    /// desk-run, and every agent command by name when all of them fit in the turn.
    pub(crate) fn offer(&self) -> Option<Vec<ToolDefinition>> {
        let commands = self.agent_commands();
        if commands.is_empty() {
            return None;
        }
        let mut tools = vec![desk_tools(), desk_run()];
        let direct: Vec<ToolDefinition> = commands.iter().filter_map(direct).collect();
        if direct.len() <= TURN_TOOLS - tools.len() {
            tools.extend(direct);
        }
        Some(tools)
    }

    /// `info` as `caller` sees it in cmd.tools, or nothing when it may not see it: an agent sees
    /// what its allowlist (`allow`) could let it run, anyone else what its grants cover.
    fn tool_for(
        &self,
        caller: &str,
        allow: Option<&[Permission]>,
        info: CommandInfo,
    ) -> Option<CommandTool> {
        let scope = invoke_scope(&info.id);
        let held = {
            let permissions = self.permissions();
            permissions
                .authorize(caller, &scope, &Target::CommandId(&info.id))
                .is_ok()
        };
        let inside = match allow {
            Some(allow) => allow.is_empty() || allow.iter().any(|a| covers(a, &scope)),
            None => held,
        };
        inside.then(|| CommandTool {
            name: tool_name(&info.id),
            granted: held,
            description: info.description.unwrap_or_default(),
            args_schema: info.args_schema,
            result_schema: info.result_schema,
            read_only: info.read_only,
            irreversible: info.irreversible,
            title: info.title,
            provider: info.provider,
            command: info.id,
        })
    }

    /// What `provider`'s manifest declares for its command `id` (`contributes.commands`).
    fn declared(&self, provider: &str, id: &str) -> Option<CommandContribution> {
        let plugins = self
            .plugins
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let declared = plugins
            .get(provider)
            .and_then(|plugin| plugin.manifest)
            .and_then(|manifest| manifest.contributes)
            .and_then(|contributes| contributes.commands);
        declared
            .unwrap_or_default()
            .into_iter()
            .find(|c| c.id == id)
    }
}

/// The `cmd:invoke` scope of one command.
pub(crate) fn invoke_scope(id: &str) -> Permission {
    Permission::CmdInvoke(CmdInvokePermission {
        permission: Default::default(),
        ids: vec![id.to_owned()],
    })
}

/// A command's tool name: its id with every dot an underscore, when that fits a brain turn.
pub(crate) fn tool_name(id: &str) -> Option<String> {
    (id.len() <= NAME_MAX).then(|| id.replace('.', "_"))
}

/// Whether every word appears in the command's id, title, description or keywords.
fn matches(info: &CommandInfo, words: &[&str]) -> bool {
    let mut text = format!("{} {}", info.id, info.title);
    for more in info
        .description
        .iter()
        .chain(info.keywords.iter().flatten())
    {
        text.push(' ');
        text.push_str(more);
    }
    let text = text.to_lowercase();
    words.iter().all(|word| text.contains(word))
}

/// An agent command as a tool of its own, when its name and its args schema fit a brain turn.
fn direct(info: &CommandInfo) -> Option<ToolDefinition> {
    let name = tool_name(&info.id)?;
    let mut schema = info.args_schema.clone().unwrap_or_else(|| {
        let none = json!({ "type": "object", "properties": {}, "additionalProperties": false });
        none.as_object().cloned().unwrap_or_default()
    });
    match schema.get("type") {
        None => {
            schema.insert("type".to_owned(), json!("object"));
        }
        Some(kind) if kind != "object" => return None,
        Some(_) => {}
    }
    let mut description = info
        .description
        .clone()
        .unwrap_or_else(|| info.title.clone());
    if info.read_only == Some(true) {
        description.push_str(" It only reads.");
    }
    if info.irreversible == Some(true) {
        description.push_str(" The person approves every call.");
    }
    Some(ToolDefinition {
        name,
        description,
        schema,
    })
}

fn desk_tools() -> ToolDefinition {
    ToolDefinition {
        name: DESK_TOOLS.to_owned(),
        description: "List the commands of the desk's plugins you can run as tools: what each \
            does, its args (argsSchema), what it answers (resultSchema), whether it only reads, \
            whether the person approves every call (irreversible) and whether a grant of yours \
            covers it already (granted). Words in query narrow the list."
            .to_owned(),
        schema: object(json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "minLength": 1, "maxLength": 200 },
                "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
            },
            "additionalProperties": false
        })),
    }
}

fn desk_run() -> ToolDefinition {
    ToolDefinition {
        name: DESK_RUN.to_owned(),
        description: "Run one of the desk's commands by its id (command, as desk-tools lists \
            it) with args that match its argsSchema, and get what it answers. Without a grant \
            that covers it the person is asked first, and an irreversible command waits for \
            their approval."
            .to_owned(),
        schema: object(json!({
            "type": "object",
            "properties": {
                "command": { "type": "string", "pattern": "^[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)+$" },
                "args": { "type": "object" }
            },
            "required": ["command"],
            "additionalProperties": false
        })),
    }
}

fn object(value: Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(id: &str, args: Option<Value>) -> CommandInfo {
        CommandInfo {
            id: id.to_owned(),
            title: "Title".to_owned(),
            description: Some("Does it.".to_owned()),
            keywords: Some(vec!["Branch".to_owned()]),
            args_schema: args.and_then(|a| a.as_object().cloned()),
            when: None,
            provider: "endue.git".to_owned(),
            undo: None,
            result_schema: None,
            agent: Some(true),
            read_only: Some(true),
            irreversible: None,
        }
    }

    #[test]
    fn a_tool_name_is_the_id_with_underscores_and_fits_a_turn() {
        assert_eq!(
            tool_name("endue.git.state").as_deref(),
            Some("endue_git_state")
        );
        assert_eq!(tool_name("a.b-c").as_deref(), Some("a_b-c"));
        let long = format!("example.{}", "x".repeat(60));
        assert_eq!(tool_name(&long), None);
    }

    #[test]
    fn every_word_of_a_query_must_appear() {
        let state = info("endue.git.state", None);
        assert!(matches(&state, &[]));
        assert!(matches(&state, &["git", "branch"]));
        assert!(matches(&state, &["does"]));
        assert!(!matches(&state, &["git", "push"]));
    }

    #[test]
    fn a_direct_tool_takes_an_object_schema_and_says_it_only_reads() {
        let tool = direct(&info("endue.git.state", None)).unwrap();
        assert_eq!(tool.name, "endue_git_state");
        assert_eq!(tool.schema["type"], "object");
        assert!(tool.description.ends_with("It only reads."));
        let typed = direct(&info("endue.git.diff", Some(json!({ "properties": {} })))).unwrap();
        assert_eq!(typed.schema["type"], "object");
        assert!(direct(&info("endue.git.log", Some(json!({ "type": "array" })))).is_none());
    }
}
