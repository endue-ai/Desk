//! The cmd side of `Core`: the one command registry (ADR 0017). Every caller registers its own
//! commands (the runtime registers the desk's built-in ones as `desk`); cmd.invoke checks the
//! caller's `cmd:invoke` grant and the args, then the provider hears `cmd.invoked`, runs the command
//! and answers with cmd.answer, which reaches the caller as `cmd.answered`. The registry keeps which
//! commands their provider's manifest marks `irreversible`: an agent's call of one waits for the
//! person's approval (`approvals`, ADR 0078), and lands the ok answers of commands that name an
//! `undo` on the desk's undo stack (`core_undo`, ADR 0077).

use std::collections::{BTreeMap, BTreeSet};
use std::sync::MutexGuard;

use desk_bridge::{
    BridgeEvent, CmdAnswerParams, CmdAnswerResult, CmdAnsweredData, CmdAnsweredEvent,
    CmdChangedData, CmdChangedEvent, CmdInvokeParams, CmdInvokeResult, CmdInvokedData,
    CmdInvokedEvent, CmdListParams, CmdListResult, CmdRegisterParams, CmdRegisterResult,
    CmdUnregisterParams, CmdUnregisterResult, CommandChange, CommandContribution, CommandFailure,
    CommandFailureCode, CommandInfo, ErrorCode, EventName, Permission,
};
use serde_json::{Map, Value};

use crate::approvals::Action;
use crate::handler::{Answer, Core, error, json};
use crate::manifest::schema_registry;
use crate::perm::{Target, star_match};

/// Why an invocation runs: asked for, or the undo stack's inverse or redo (`core_undo`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Command,
    Undo,
    Redo,
}

struct Invocation {
    id: String,
    caller: String,
    provider: String,
    args: Option<Map<String, Value>>,
    /// The command's inverse when it has one: an ok answer lands on the undo stack.
    undo: Option<String>,
    kind: Kind,
}

/// Registered commands in registration order, and the invocations still waiting for an answer.
#[derive(Default)]
pub(crate) struct Commands {
    pub(crate) order: Vec<String>,
    pub(crate) by_id: BTreeMap<String, CommandInfo>,
    next: u64,
    pending: BTreeMap<String, Invocation>,
    /// Ids whose provider's manifest marks them `irreversible`.
    irreversible: BTreeSet<String>,
}

impl Core {
    pub(crate) fn cmd_register(&self, caller: &str, params: CmdRegisterParams) -> Answer {
        let info = CommandInfo {
            id: params.id.clone(),
            title: params.title,
            description: params.description,
            keywords: params.keywords,
            args_schema: params.args_schema,
            when: params.when,
            provider: caller.to_owned(),
            undo: None,
        };
        let change = {
            let mut commands = self.commands();
            match commands.by_id.get(&params.id) {
                Some(existing) if existing.provider != caller => {
                    return Err(error(
                        ErrorCode::AlreadyExists,
                        format!("{} is provided by {}", params.id, existing.provider),
                    ));
                }
                Some(_) => CommandChange::Updated,
                None => {
                    commands.order.push(params.id.clone());
                    CommandChange::Registered
                }
            }
        };
        let declared = self.declared(caller, &params.id);
        let irreversible = declared.as_ref().and_then(|c| c.irreversible) == Some(true);
        // The manifest's undo when the call names none (ADR 0077).
        let undo = params.undo.or_else(|| declared.and_then(|c| c.undo));
        {
            let mut commands = self.commands();
            commands
                .by_id
                .insert(params.id.clone(), CommandInfo { undo, ..info });
            if irreversible {
                commands.irreversible.insert(params.id.clone());
            } else {
                commands.irreversible.remove(&params.id);
            }
        }
        self.cmd_changed(&params.id, change, caller);
        json(CmdRegisterResult {})
    }

    pub(crate) fn cmd_unregister(&self, caller: &str, params: CmdUnregisterParams) -> Answer {
        let provided = self
            .commands()
            .by_id
            .get(&params.id)
            .is_some_and(|c| c.provider == caller);
        if !provided {
            return Err(error(
                ErrorCode::NotFound,
                format!("{caller} provides no command {}", params.id),
            ));
        }
        self.remove_command(&params.id);
        json(CmdUnregisterResult {})
    }

    pub(crate) fn cmd_list(&self, caller: &str, params: CmdListParams) -> Answer {
        let scope = Permission::CmdInvoke(params.scope.clone());
        self.check(caller, &scope, &Target::None)?;
        let commands = self.commands();
        let listed = commands
            .order
            .iter()
            .filter_map(|id| commands.by_id.get(id))
            .filter(|c| params.scope.ids.iter().any(|p| star_match(p, &c.id)))
            .cloned()
            .collect();
        json(CmdListResult { commands: listed })
    }

    /// The registered commands a `cmd:invoke` grant of the caller covers, in registration order,
    /// as cmd.list lists them. No grant is spent.
    pub(crate) fn commands_covered(&self, caller: &str) -> Vec<CommandInfo> {
        let registered: Vec<CommandInfo> = {
            let commands = self.commands();
            let all = commands
                .order
                .iter()
                .filter_map(|id| commands.by_id.get(id));
            all.cloned().collect()
        };
        let permissions = self.permissions();
        registered
            .into_iter()
            .filter(|c| {
                let scope = Permission::CmdInvoke(desk_bridge::CmdInvokePermission {
                    permission: Default::default(),
                    ids: vec![c.id.clone()],
                });
                let target = Target::CommandId(&c.id);
                permissions.authorize(caller, &scope, &target).is_ok()
            })
            .collect()
    }

    pub(crate) fn cmd_invoke(&self, caller: &str, params: CmdInvokeParams) -> Answer {
        let scope = Permission::CmdInvoke(params.scope);
        self.check(caller, &scope, &Target::CommandId(&params.id))?;
        let invocation_id =
            self.start_invocation(caller, &scope, &params.id, params.args, Kind::Command)?;
        json(CmdInvokeResult { invocation_id })
    }

    /// Invoke `id` as `caller`, whose `scope` was checked: its args against the command's schema,
    /// an agent's call held for the person (ADR 0078), then `cmd.invoked` to the provider. Answers
    /// the invocation id.
    pub(crate) fn start_invocation(
        &self,
        caller: &str,
        scope: &Permission,
        id: &str,
        args: Option<Map<String, Value>>,
        kind: Kind,
    ) -> Result<String, desk_bridge::BridgeError> {
        let info = self
            .commands()
            .by_id
            .get(id)
            .cloned()
            .ok_or_else(|| error(ErrorCode::NotFound, format!("no command {id}")))?;
        if let Some(schema) = &info.args_schema {
            check_args(schema, args.as_ref())?;
        }
        let invoke = Action::Invoke {
            id,
            args: args.as_ref(),
        };
        self.hold(caller, scope, invoke)?;
        let invocation_id = {
            let mut commands = self.commands();
            commands.next += 1;
            let invocation_id = format!("i-{}", commands.next);
            commands.pending.insert(
                invocation_id.clone(),
                Invocation {
                    id: id.to_owned(),
                    caller: caller.to_owned(),
                    provider: info.provider.clone(),
                    args: args.clone(),
                    undo: info.undo.clone(),
                    kind,
                },
            );
            invocation_id
        };
        self.note_invoked(&invocation_id, id, caller, &info.provider);
        let to = self.recipients(EventName::CmdInvoked, vec![info.provider]);
        self.events().publish_to(
            to,
            BridgeEvent::CmdInvoked(CmdInvokedEvent {
                event: Default::default(),
                data: CmdInvokedData {
                    invocation_id: invocation_id.clone(),
                    id: id.to_owned(),
                    args,
                    caller: caller.to_owned(),
                },
            }),
        );
        Ok(invocation_id)
    }

    pub(crate) fn cmd_answer(&self, caller: &str, params: CmdAnswerParams) -> Answer {
        let invocation = {
            let mut commands = self.commands();
            match commands.pending.get(&params.invocation_id) {
                Some(i) if i.provider == caller => commands.pending.remove(&params.invocation_id),
                _ => None,
            }
        }
        .ok_or_else(|| {
            error(
                ErrorCode::NotFound,
                format!("{caller} has no invocation {}", params.invocation_id),
            )
        })?;
        self.answered(
            &params.invocation_id,
            invocation,
            params.result,
            params.error,
        );
        json(CmdAnswerResult {})
    }

    /// A provider stopped (its plugin was turned off or removed): its commands go, and invocations
    /// still waiting on it are answered `cancelled`.
    pub(crate) fn drop_provider(&self, provider: &str) {
        let ids: Vec<String> = self
            .commands()
            .by_id
            .values()
            .filter(|c| c.provider == provider)
            .map(|c| c.id.clone())
            .collect();
        for id in ids {
            self.remove_command(&id);
        }
        let waiting: Vec<(String, Invocation)> = {
            let mut commands = self.commands();
            let keys: Vec<String> = commands
                .pending
                .iter()
                .filter(|(_, i)| i.provider == provider)
                .map(|(k, _)| k.clone())
                .collect();
            keys.into_iter()
                .filter_map(|k| commands.pending.remove(&k).map(|i| (k, i)))
                .collect()
        };
        for (invocation_id, invocation) in waiting {
            let failure = CommandFailure {
                code: CommandFailureCode::Cancelled,
                message: format!("{provider} stopped before it answered"),
            };
            self.answered(&invocation_id, invocation, None, Some(failure));
        }
    }

    fn remove_command(&self, id: &str) {
        let removed = {
            let mut commands = self.commands();
            commands.order.retain(|other| other != id);
            commands.irreversible.remove(id);
            commands.by_id.remove(id)
        };
        if let Some(info) = removed {
            self.cmd_changed(id, CommandChange::Unregistered, &info.provider);
        }
    }

    fn answered(
        &self,
        invocation_id: &str,
        invocation: Invocation,
        result: Option<Value>,
        error: Option<CommandFailure>,
    ) {
        self.note_answered(invocation_id, error.as_ref().map(|failure| failure.code));
        // An ok answer of an undoable command lands on the undo stack; an inverse's does not, and a
        // redo's leaves what is left to redo (ADR 0077).
        if let (None, Some(inverse), false) =
            (&error, &invocation.undo, invocation.kind == Kind::Undo)
        {
            let entry = self.command_entry(
                &invocation.id,
                invocation.args.clone(),
                result.clone(),
                &invocation.caller,
                inverse,
            );
            self.push_undo(entry, invocation.kind == Kind::Command);
        }
        self.events()
            .publish(BridgeEvent::CmdAnswered(CmdAnsweredEvent {
                event: Default::default(),
                data: CmdAnsweredData {
                    invocation_id: invocation_id.to_owned(),
                    id: invocation.id,
                    caller: invocation.caller,
                    ok: error.is_none(),
                    result: if error.is_none() { result } else { None },
                    error,
                },
            }));
    }

    /// Whether the registered command `id` is irreversible.
    pub(crate) fn irreversible_command(&self, id: &str) -> bool {
        self.commands().irreversible.contains(id)
    }

    /// What `provider`'s manifest declares for its command `id` (`contributes.commands`).
    pub(crate) fn declared(&self, provider: &str, id: &str) -> Option<CommandContribution> {
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

    /// `cmd.changed` for the provider and the callers subscribed to it.
    fn cmd_changed(&self, id: &str, change: CommandChange, provider: &str) {
        let to = self.recipients(EventName::CmdChanged, vec![provider.to_owned()]);
        self.events().publish_to(
            to,
            BridgeEvent::CmdChanged(CmdChangedEvent {
                event: Default::default(),
                data: CmdChangedData {
                    id: id.to_owned(),
                    change,
                    provider: provider.to_owned(),
                },
            }),
        );
    }

    pub(crate) fn commands(&self) -> MutexGuard<'_, Commands> {
        self.commands
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Validate cmd.invoke's args against the command's argsSchema (absent args are `{}`).
fn check_args(
    schema: &serde_json::Map<String, Value>,
    args: Option<&serde_json::Map<String, Value>>,
) -> Result<(), desk_bridge::BridgeError> {
    let validator = jsonschema::options()
        .with_registry(schema_registry())
        .should_validate_formats(false)
        .build(&Value::Object(schema.clone()))
        .map_err(|e| error(ErrorCode::InvalidParams, format!("argsSchema: {e}")))?;
    let args = Value::Object(args.cloned().unwrap_or_default());
    let problems: Vec<String> = validator
        .iter_errors(&args)
        .map(|e| format!("args{}: {e}", e.instance_path()))
        .collect();
    if problems.is_empty() {
        Ok(())
    } else {
        Err(error(ErrorCode::InvalidParams, problems.join("; ")))
    }
}
