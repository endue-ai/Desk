//! The cmd side of `Core`: the one command registry (ADR 0017). Every caller registers its own
//! commands (the runtime registers the desk's built-in ones as `desk`); cmd.invoke checks the
//! caller's `cmd:invoke` grant and the args, then the provider hears `cmd.invoked`, runs the command
//! and answers with cmd.answer, which reaches the caller as `cmd.answered`.

use std::collections::BTreeMap;
use std::sync::MutexGuard;

use desk_bridge::{
    BridgeEvent, CmdAnswerParams, CmdAnswerResult, CmdAnsweredData, CmdAnsweredEvent,
    CmdChangedData, CmdChangedEvent, CmdInvokeParams, CmdInvokeResult, CmdInvokedData,
    CmdInvokedEvent, CmdListParams, CmdListResult, CmdRegisterParams, CmdRegisterResult,
    CmdUnregisterParams, CmdUnregisterResult, CommandChange, CommandFailure, CommandFailureCode,
    CommandInfo, ErrorCode, EventName, Permission,
};
use serde_json::Value;

use crate::handler::{Answer, Core, error, json};
use crate::manifest::schema_registry;
use crate::perm::{Target, star_match};

struct Invocation {
    id: String,
    caller: String,
    provider: String,
}

/// Registered commands in registration order, and the invocations still waiting for an answer.
#[derive(Default)]
pub(crate) struct Commands {
    order: Vec<String>,
    by_id: BTreeMap<String, CommandInfo>,
    next: u64,
    pending: BTreeMap<String, Invocation>,
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
        self.commands().by_id.insert(params.id.clone(), info);
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

    pub(crate) fn cmd_invoke(&self, caller: &str, params: CmdInvokeParams) -> Answer {
        let scope = Permission::CmdInvoke(params.scope);
        self.check(caller, &scope, &Target::CommandId(&params.id))?;
        let info = self
            .commands()
            .by_id
            .get(&params.id)
            .cloned()
            .ok_or_else(|| error(ErrorCode::NotFound, format!("no command {}", params.id)))?;
        if let Some(schema) = &info.args_schema {
            check_args(schema, params.args.as_ref())?;
        }
        let invocation_id = {
            let mut commands = self.commands();
            commands.next += 1;
            let invocation_id = format!("i-{}", commands.next);
            commands.pending.insert(
                invocation_id.clone(),
                Invocation {
                    id: params.id.clone(),
                    caller: caller.to_owned(),
                    provider: info.provider.clone(),
                },
            );
            invocation_id
        };
        let to = self.recipients(EventName::CmdInvoked, vec![info.provider]);
        self.events().publish_to(
            to,
            BridgeEvent::CmdInvoked(CmdInvokedEvent {
                event: Default::default(),
                data: CmdInvokedData {
                    invocation_id: invocation_id.clone(),
                    id: params.id,
                    args: params.args,
                    caller: caller.to_owned(),
                },
            }),
        );
        json(CmdInvokeResult { invocation_id })
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

    fn commands(&self) -> MutexGuard<'_, Commands> {
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
