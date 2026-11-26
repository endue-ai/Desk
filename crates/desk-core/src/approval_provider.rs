//! The one process a Terminal command invocation may start using its approval.

use desk_bridge::{CommandInfo, Permission, ProcSpawnParams};
use serde_json::{Map, Value};

use crate::handler::Core;

pub(crate) const TERMINAL_RUN: &str = "endue.terminal.run";
pub(crate) const TERMINAL: &str = "endue.terminal";
pub(crate) const DOCKER: &str = "endue.docker";
pub(crate) const DOCKER_STUDIO: &str = "endue.docker-studio";

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
        caller: &str,
        reviewed: bool,
        info: &CommandInfo,
        args: Option<&Map<String, Value>>,
    ) -> Option<ProviderApproval> {
        if info.id != TERMINAL_RUN || !self.trusted_builtin(&info.provider, TERMINAL) {
            return None;
        }
        let args = args?;
        let approval = ProviderApproval::terminal(args)?;
        let docker_shell = args.get("dockerShell").and_then(Value::as_bool) == Some(true)
            && (self.trusted_builtin(caller, DOCKER)
                || self.trusted_builtin(caller, DOCKER_STUDIO))
            && approval.is_docker_shell();
        (reviewed || docker_shell).then_some(approval)
    }
}

impl ProviderApproval {
    fn is_docker_shell(&self) -> bool {
        if self.program != "docker" || self.cwd.is_some() {
            return false;
        }
        let argv: Vec<&str> = self.args.iter().map(String::as_str).collect();
        let argv = match argv.as_slice() {
            ["--context", context, rest @ ..] if docker_name(context, b"_.+-") => rest,
            plain => plain,
        };
        match argv {
            ["exec", "-it", "--", container, shell]
            | ["exec", "--interactive", "--tty", "--", container, shell] => {
                docker_name(container, b"_.-")
                    && !shell.is_empty()
                    && !shell.starts_with('-')
                    && shell.len() <= 4096
                    && shell
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_./-:\\".contains(&b))
            }
            _ => false,
        }
    }
}

fn docker_name(name: &str, extra: &[u8]) -> bool {
    name.len() <= 255
        && name
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || extra.contains(&b))
}
