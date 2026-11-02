//! What an approval is about (ADR 0078): the agent's call (`fs.write`, `proc.spawn`, `net.fetch`,
//! `cmd.invoke`), its target, what a `task` answer approves for the rest of the task, and the
//! `perm.approval` it shows, with its preview (`approval_preview`).

use std::path::Path;

use desk_bridge::{ApprovalAction, CmdInvokePermission, PermApprovalData, Permission};
use serde_json::{Map, Value};

use crate::approval_preview::{args_preview, command_preview, url_preview, write_preview};
use crate::perm::Target;

/// An agent's call that may need the person's approval, with what its preview is made of.
pub(crate) enum Action<'a> {
    Write {
        path: &'a str,
        file: &'a Path,
        bytes: &'a [u8],
    },
    Spawn {
        command: &'a str,
        args: &'a [String],
    },
    Fetch {
        method: &'a str,
        url: &'a str,
    },
    Invoke {
        id: &'a str,
        args: Option<&'a Map<String, Value>>,
    },
}

impl<'a> Action<'a> {
    pub(crate) fn kind(&self) -> ApprovalAction {
        match self {
            Self::Write { .. } => ApprovalAction::FsWrite,
            Self::Spawn { .. } => ApprovalAction::ProcSpawn,
            Self::Fetch { .. } => ApprovalAction::NetFetch,
            Self::Invoke { .. } => ApprovalAction::CmdInvoke,
        }
    }

    pub(crate) fn target(&self) -> Target<'a> {
        match *self {
            Self::Write { path, .. } => Target::Path(path),
            Self::Spawn { command, .. } => Target::Command(command),
            Self::Fetch { url, .. } => Target::Url(url),
            Self::Invoke { id, .. } => Target::CommandId(id),
        }
    }

    pub(crate) fn target_text(&self) -> &'a str {
        match *self {
            Self::Write { path, .. } => path,
            Self::Spawn { command, .. } => command,
            Self::Fetch { url, .. } => url,
            Self::Invoke { id, .. } => id,
        }
    }

    /// The method name, as the log and the messages say it.
    pub(crate) fn method(&self) -> &'static str {
        match self.kind() {
            ApprovalAction::FsWrite => "fs.write",
            ApprovalAction::ProcSpawn => "proc.spawn",
            ApprovalAction::NetFetch => "net.fetch",
            ApprovalAction::CmdInvoke => "cmd.invoke",
        }
    }

    /// What a `task` answer approves for the rest of the task: a write's or a fetch's scope, the one
    /// command of a spawn, the one id of a command.
    pub(crate) fn task_scope(&self, scope: &Permission) -> Permission {
        match (self, scope) {
            (Self::Spawn { command, .. }, Permission::ProcSpawn(s)) => {
                let mut one = s.clone();
                one.commands = vec![(*command).to_owned()];
                Permission::ProcSpawn(one)
            }
            (Self::Invoke { id, .. }, _) => Permission::CmdInvoke(CmdInvokePermission {
                permission: Default::default(),
                ids: vec![(*id).to_owned()],
            }),
            _ => scope.clone(),
        }
    }

    pub(crate) fn data(
        &self,
        caller: &str,
        scope: &Permission,
        id: &str,
        task: Option<&str>,
    ) -> PermApprovalData {
        let (preview, size) = match *self {
            Self::Write { path, file, bytes } => {
                (write_preview(path, file, bytes), Some(bytes.len() as u64))
            }
            Self::Spawn { command, args } => (Some(command_preview(command, args)), None),
            Self::Fetch { method, url } => (Some(url_preview(method, url)), None),
            Self::Invoke { args, .. } => (Some(args_preview(args)), None),
        };
        PermApprovalData {
            approval_id: id.to_owned(),
            caller: caller.to_owned(),
            action: self.kind(),
            permission: scope.clone(),
            target: self.target_text().to_owned(),
            preview,
            size,
            task: task.map(str::to_owned),
        }
    }
}
