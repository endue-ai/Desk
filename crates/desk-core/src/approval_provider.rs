//! The one process a Terminal command invocation may start using its approval.

use desk_bridge::{CommandInfo, Permission, ProcSpawnParams};
use serde_json::{Map, Value};

use crate::handler::Core;

pub(crate) const TERMINAL_RUN: &str = "endue.terminal.run";
pub(crate) const TERMINAL: &str = "endue.terminal";

pub(crate) struct ProviderApproval {
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    used: bool,
}

impl ProviderApproval {
    fn terminal(args: &Map<String, Value>) -> Option<Self> {
        let program = args.get("command")?.as_str()?.to_owned();
        let argv = match args.get("args") {
            Some(items) => serde_json::from_value(items.clone()).ok()?,
            None => Vec::new(),
        };
        let cwd = args
            .get("cwd")
            .and_then(Value::as_str)
            .filter(|cwd| !cwd.is_empty())
            .map(str::to_owned);
        Some(Self {
            program,
            args: argv,
            cwd,
            used: false,
        })
    }

    pub(crate) fn covers(&self, permission: &Permission) -> bool {
        !self.used
            && matches!(permission,
            Permission::ProcSpawn(scope) if scope.pty == Some(true) && scope.commands == [self.program.as_str()])
    }

    pub(crate) fn use_spawn(&mut self, scope: &Permission, params: &ProcSpawnParams) -> bool {
        if !self.covers(scope)
            || params.command != self.program
            || params.args.as_deref().unwrap_or_default() != self.args
            || params.pty.is_none()
            || self
                .cwd
                .as_ref()
                .is_some_and(|cwd| params.cwd.as_ref() != Some(cwd))
        {
            return false;
        }
        self.used = true;
        true
    }
}

impl Core {
    pub(crate) fn provider_approval(
        &self,
        reviewed: bool,
        info: &CommandInfo,
        args: Option<&Map<String, Value>>,
    ) -> Option<ProviderApproval> {
        if !reviewed || info.id != TERMINAL_RUN || info.provider != TERMINAL {
            return None;
        }
        let plugin = self.registry().get(TERMINAL)?;
        if !plugin.built_in || !plugin.enabled {
            return None;
        }
        ProviderApproval::terminal(args?)
    }
}
