//! The cmd side of `Core`: the one command registry (ADR 0017). Every caller registers its own
//! commands (the runtime registers the desk's built-in ones as `desk`); cmd.invoke checks the
//! caller's `cmd:invoke` grant and the args, then the provider hears `cmd.invoked`, runs the command
//! and answers with cmd.answer, which reaches the caller as `cmd.answered`. The registry tracks
//! irreversible commands from the desk or a plugin's manifest. An agent waits for the person's
//! approval (`approvals`, ADR 0078). The ok answers of commands that name an
//! `undo` land on the desk's undo stack (`core_undo`, ADR 0077). What a registration leaves out comes
//! from the manifest (`core_tools::described`), and commands marked `agent` are agents' tools
//! (`core_tools`, ADR 0088).

#[path = "core_cmd_context.rs"]
mod context;

pub(crate) use context::AgentInvocation;

use std::collections::BTreeMap;
use std::sync::MutexGuard;

use desk_bridge::{
    BridgeEvent, CmdAnswerParams, CmdAnswerResult, CmdAnsweredData, CmdAnsweredEvent,
    CmdChangedData, CmdChangedEvent, CmdInvokeParams, CmdInvokeResult, CmdInvokedData,
    CmdInvokedEvent, CmdListParams, CmdListResult, CmdRegisterParams, CmdRegisterResult,
    CmdUnregisterParams, CmdUnregisterResult, CommandChange, CommandFailure, CommandFailureCode,
    CommandInfo, ErrorCode, EventName, Permission,
};
use serde_json::{Map, Value};

use crate::approval_provider::ProviderApproval;
use crate::approvals::{Action, current_task};
use crate::core_cmd_args::check_args;
use crate::handler::{Answer, Core, error, json};
use crate::paths::star_match;
use crate::perm::Target;

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
    approval: Option<ProviderApproval>,
    agent: Option<AgentInvocation>,
    browser_act: bool,
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
        let info = self.described(caller, params)?;
        let change = {
            let mut commands = self.commands();
            match commands.by_id.get(&info.id) {
                Some(existing) if existing.provider != caller => {
                    return Err(error(
                        ErrorCode::AlreadyExists,
                        format!("{} is provided by {}", info.id, existing.provider),
                    ));
                }
                Some(_) => CommandChange::Updated,
                None => {
                    commands.order.push(info.id.clone());
                    CommandChange::Registered
                }
            }
        };
        let id = info.id.clone();
        self.commands().by_id.insert(id.clone(), info);
        self.cmd_changed(&id, change, caller);
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
        // Its provider took it back: what still waits on it would wait forever.
        let message = format!("{} was unregistered before it answered", params.id);
        self.cancel_waiting(|i| i.provider == caller && i.id == params.id, &message);
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
        let registered = self.registered();
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
        let invocation_id =
            self.start_invocation(caller, &scope, &params.id, params.args, Kind::Command)?;
        json(CmdInvokeResult { invocation_id })
    }

    /// Check scope and args, hold an agent when needed, then deliver `cmd.invoked` (ADR 0078).
    pub(crate) fn start_invocation(
        &self,
        caller: &str,
        scope: &Permission,
        id: &str,
        args: Option<Map<String, Value>>,
        kind: Kind,
    ) -> Result<String, desk_bridge::BridgeError> {
        let (info, review) = match kind {
            Kind::Command => self.checked_command(caller, scope, id, args.as_ref())?,
            Kind::Undo | Kind::Redo => (self.command(id), false),
        };
        let info = info.ok_or_else(|| error(ErrorCode::NotFound, format!("no command {id}")))?;
        if let Some(schema) = &info.args_schema {
            check_args(schema, args.as_ref())?;
        }
        let browser_act = kind == Kind::Command && self.delegates_web_act(&info);
        let review = review && !browser_act;
        let invoke = Action::Invoke {
            id,
            args: args.as_ref(),
        };
        // An agent's call is a run from here on (ADR 0100), waiting while it is held.
        let run = self.run_started(caller, id, args.as_ref());
        let held = self.held_as(run.as_deref(), || match kind {
            Kind::Command => self.hold_checked(caller, scope, invoke, review),
            Kind::Undo | Kind::Redo => self.hold(caller, scope, invoke),
        });
        let held = held.and_then(|()| {
            if review && self.command(id).as_ref() != Some(&info) {
                return Err(error(
                    ErrorCode::Cancelled,
                    format!("{id} changed before it ran"),
                ));
            }
            Ok(())
        });
        if let (Some(run), Err(refused)) = (&run, &held) {
            self.run_went_on(run, Err(&refused.message));
        }
        held?;
        let file_open_granted = self.file_open_granted(caller, id, &info.provider, args.as_ref());
        let approval = self.provider_approval(review, &info, args.as_ref());
        let approved = approval.is_some().then_some(true);
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
                    approval,
                    agent: run.as_ref().map(|run| AgentInvocation {
                        caller: caller.to_owned(),
                        run: run.clone(),
                        turn: current_task(),
                    }),
                    browser_act,
                },
            );
            invocation_id
        };
        if let Some(run) = &run {
            self.run_went_on(run, Ok(&invocation_id));
        }
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
                    approved,
                    file_open_granted,
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
        let message = format!("{provider} stopped before it answered");
        self.cancel_waiting(|i| i.provider == provider, &message);
    }

    /// Answer every waiting invocation `which` picks `cancelled`, with `message`.
    fn cancel_waiting(&self, which: impl Fn(&Invocation) -> bool, message: &str) {
        let waiting: Vec<(String, Invocation)> = {
            let mut commands = self.commands();
            let keys: Vec<String> = commands
                .pending
                .iter()
                .filter(|(_, i)| which(i))
                .map(|(k, _)| k.clone())
                .collect();
            keys.into_iter()
                .filter_map(|k| commands.pending.remove(&k).map(|i| (k, i)))
                .collect()
        };
        for (invocation_id, invocation) in waiting {
            let failure = CommandFailure {
                code: CommandFailureCode::Cancelled,
                message: message.to_owned(),
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
        self.note_answered(invocation_id, error.as_ref().map(|failure| failure.code));
        let failure = error
            .as_ref()
            .map(|f| (f.code == CommandFailureCode::Cancelled, f.message.as_str()));
        self.run_answered(invocation_id, result.as_ref(), failure);
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

    /// Answer the waiting invocation `invocation_id` with `failure` for its provider (agent.cancel):
    /// its caller hears it cancelled, and a late answer from the provider finds nothing.
    pub(crate) fn cancel_invocation(&self, invocation_id: &str, failure: CommandFailure) -> bool {
        let invocation = self.commands().pending.remove(invocation_id);
        let Some(invocation) = invocation else {
            return false;
        };
        self.answered(invocation_id, invocation, None, Some(failure));
        true
    }

    /// The registered command `id`.
    pub(crate) fn command(&self, id: &str) -> Option<CommandInfo> {
        self.commands().by_id.get(id).cloned()
    }

    /// The registered commands, in registration order.
    pub(crate) fn registered(&self) -> Vec<CommandInfo> {
        let commands = self.commands();
        let all = commands
            .order
            .iter()
            .filter_map(|id| commands.by_id.get(id));
        all.cloned().collect()
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
