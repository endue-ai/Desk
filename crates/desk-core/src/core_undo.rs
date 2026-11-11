//! The desk's undo stack (ADR 0077): one for the desk, whoever pushed. The registry pushes an entry
//! when a command that names an `undo` is answered ok (`core_cmd`), and the fs side when a write
//! keeps a version (`core_fs`, `core_history`) and a rename, copy or mkdir changes files (ADR 0125);
//! cmd.undo runs the newest entry's inverse with `{ args, result }` (a write: restores its version;
//! a file operation: `core_fs::undo` reverses it) and moves it to the redo side, which cmd.redo
//! walks back and a new entry clears. Inverses and redos the stack runs push nothing of their own,
//! but a redone command's answer lands on the stack again. A command's entry whose inverse cannot
//! start for any reason but a refusal to the caller (it is not registered any more, it does not
//! accept the args) leaves the stack with the error, so it never blocks the entries before it.
//! Kept in memory: 200 entries.

use std::collections::VecDeque;
use std::sync::MutexGuard;

use desk_bridge::{
    BridgeError, BridgeEvent, CmdRedoParams, CmdRedoResult, CmdUndoParams, CmdUndoResult,
    CmdUndoneData, CmdUndoneEvent, ErrorCode, EventName, Permission, UndoEntry,
};
use desk_plugin_host::rfc3339;
use serde_json::{Map, Value, json};

use crate::core_cmd::Kind;
use crate::core_fs::is_fs_op;
use crate::handler::{Answer, Core, json as answer};
use crate::perm::Target;

/// How many entries the stack keeps; the oldest goes first.
pub(crate) const MAX_ENTRIES: usize = 200;

/// The command id a write's entry is undone and redone with.
const RESTORE: &str = "fs.restore";

#[derive(Default)]
pub(crate) struct Stacks {
    undo: VecDeque<UndoEntry>,
    redo: Vec<UndoEntry>,
}

/// Whether `entry` is a write the core kept a version of: undone and redone by restoring one.
fn is_write(entry: &UndoEntry) -> bool {
    entry.inverse == RESTORE && matches!(entry.command.as_str(), "fs.write" | "fs.restore")
}

/// Whether `entry` stays on the stack after its undo failed with `why`. A write and a file operation
/// stay (ADR 0076, 0125): the person can clear the way and undo again. A command's entry stays when
/// its inverse was refused to this caller (another caller, or the person's later yes, may run it);
/// an inverse that is gone or refuses the entry's `{ args, result }` never will.
fn stays(entry: &UndoEntry, why: &BridgeError) -> bool {
    is_write(entry) || is_fs_op(entry) || why.code == ErrorCode::PermissionDenied
}

/// `entry` with `result.version` set to `version`.
fn with_version(entry: &UndoEntry, version: String) -> UndoEntry {
    let mut next = entry.clone();
    next.result = Some(json!({ "version": version }));
    next
}

impl Core {
    /// Push an entry; a new one (not a redo's) clears what is left to redo.
    pub(crate) fn push_undo(&self, entry: UndoEntry, clear_redo: bool) {
        let mut stacks = self.stacks();
        if clear_redo {
            stacks.redo.clear();
        }
        stacks.undo.push_back(entry);
        while stacks.undo.len() > MAX_ENTRIES {
            stacks.undo.pop_front();
        }
    }

    /// The entry for an invocation of `command` answered with `result`.
    pub(crate) fn command_entry(
        &self,
        command: &str,
        args: Option<Map<String, Value>>,
        result: Option<Value>,
        caller: &str,
        inverse: &str,
    ) -> UndoEntry {
        UndoEntry {
            command: command.to_owned(),
            args,
            result,
            caller: caller.to_owned(),
            at: rfc3339(self.clock.now()),
            inverse: inverse.to_owned(),
        }
    }

    /// Push a write of `path` (a bridge path) that kept `version`.
    pub(crate) fn push_write(&self, caller: &str, command: &str, path: &str, version: String) {
        let mut args = Map::new();
        args.insert("path".to_owned(), json!(path));
        let result = Some(json!({ "version": version }));
        let entry = self.command_entry(command, Some(args), result, caller, RESTORE);
        self.push_undo(entry, true);
    }

    pub(crate) fn cmd_undo(&self, caller: &str, params: CmdUndoParams) -> Answer {
        let scope = Permission::CmdInvoke(params.scope);
        let Some(top) = self.stacks().undo.back().cloned() else {
            return answer(CmdUndoResult {
                undone: None,
                invocation_id: None,
            });
        };
        self.check(caller, &scope, &Target::CommandId(&top.inverse))?;
        let Some(entry) = self.stacks().undo.pop_back() else {
            return answer(CmdUndoResult {
                undone: None,
                invocation_id: None,
            });
        };
        let undone = self.reverse(caller, &scope, &entry);
        let invocation_id = match undone {
            Ok((invocation, redo)) => {
                self.stacks().redo.extend(redo);
                invocation
            }
            Err(why) if stays(&entry, &why) => {
                self.stacks().undo.push_back(entry);
                return Err(why);
            }
            Err(why) => {
                let message = format!(
                    "{} cannot be undone, so it left the undo stack: {}",
                    entry.command, why.message
                );
                return Err(BridgeError { message, ..why });
            }
        };
        self.undone(caller, &entry, false);
        answer(CmdUndoResult {
            undone: Some(entry),
            invocation_id,
        })
    }

    pub(crate) fn cmd_redo(&self, caller: &str, params: CmdRedoParams) -> Answer {
        let scope = Permission::CmdInvoke(params.scope);
        let Some(top) = self.stacks().redo.last().cloned() else {
            return answer(CmdRedoResult {
                undone: None,
                invocation_id: None,
            });
        };
        let target = if is_write(&top) {
            RESTORE
        } else {
            &top.command
        };
        self.check(caller, &scope, &Target::CommandId(target))?;
        let Some(entry) = self.stacks().redo.pop() else {
            return answer(CmdRedoResult {
                undone: None,
                invocation_id: None,
            });
        };
        let redone = if is_write(&entry) {
            self.restore_entry(caller, &scope, &entry).map(|kept| {
                if let Some(version) = kept {
                    self.push_undo(with_version(&entry, version), false);
                }
                None
            })
        } else if is_fs_op(&entry) {
            self.redo_fs_op(&entry).map(|next| {
                self.push_undo(next, false);
                None
            })
        } else {
            let args = entry.args.clone();
            self.start_invocation(caller, &scope, &entry.command, args, Kind::Redo)
                .map(Some)
        };
        let invocation_id = match redone {
            Ok(invocation) => invocation,
            Err(why) => {
                self.stacks().redo.push(entry);
                return Err(why);
            }
        };
        self.undone(caller, &entry, true);
        answer(CmdRedoResult {
            undone: Some(entry),
            invocation_id,
        })
    }

    /// Run `entry`'s inverse as `caller`: the invocation it started, if any, and what goes on the
    /// redo side.
    fn reverse(
        &self,
        caller: &str,
        scope: &Permission,
        entry: &UndoEntry,
    ) -> Result<(Option<String>, Option<UndoEntry>), BridgeError> {
        if is_write(entry) {
            let kept = self.restore_entry(caller, scope, entry)?;
            return Ok((None, kept.map(|version| with_version(entry, version))));
        }
        if is_fs_op(entry) {
            // A rename, a copy or a new folder: core_fs runs its inverse (ADR 0125).
            self.undo_fs_op(entry)?;
            return Ok((None, Some(entry.clone())));
        }
        let mut args = Map::new();
        args.insert(
            "args".to_owned(),
            Value::Object(entry.args.clone().unwrap_or_default()),
        );
        args.insert(
            "result".to_owned(),
            entry.result.clone().unwrap_or(Value::Null),
        );
        let invocation =
            self.start_invocation(caller, scope, &entry.inverse, Some(args), Kind::Undo)?;
        Ok((Some(invocation), Some(entry.clone())))
    }

    /// Restore the version a write's entry names, as `caller`: the version that keeps what the
    /// restore replaced.
    fn restore_entry(
        &self,
        caller: &str,
        scope: &Permission,
        entry: &UndoEntry,
    ) -> Result<Option<String>, BridgeError> {
        let field = |value: Option<&Value>, key: &str| {
            value
                .and_then(|v| v.get(key))
                .and_then(Value::as_str)
                .map(str::to_owned)
        };
        let args = entry.args.as_ref().map(|a| Value::Object(a.clone()));
        let path = field(args.as_ref(), "path").unwrap_or_default();
        let version = field(entry.result.as_ref(), "version").unwrap_or_default();
        self.restore_as(caller, scope, &path, &version)
    }

    /// `cmd.undone` for the caller that did it and the callers subscribed to it.
    fn undone(&self, caller: &str, entry: &UndoEntry, redo: bool) {
        let to = self.recipients(EventName::CmdUndone, vec![caller.to_owned()]);
        self.events().publish_to(
            to,
            BridgeEvent::CmdUndone(CmdUndoneEvent {
                event: Default::default(),
                data: CmdUndoneData {
                    entry: entry.clone(),
                    by: caller.to_owned(),
                    redo,
                },
            }),
        );
    }

    fn stacks(&self) -> MutexGuard<'_, Stacks> {
        self.undo
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
