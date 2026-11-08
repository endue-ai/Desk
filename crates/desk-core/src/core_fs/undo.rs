//! What fs.rename, fs.copy and fs.mkdir put on the desk's undo stack (ADR 0077, 0125), and how
//! cmd.undo and cmd.redo run them (`core_undo` hands these entries here):
//!
//! - `{ command: fs.rename, args: { from, to } }`, undone by renaming `to` back (`fs.rename`);
//! - `{ command: fs.copy, args: { from, to } }`, undone by moving the copy to the trash (`fs.trash`);
//! - `{ command: fs.mkdir, args: { path, parents }, result: { created } }`, undone by removing the
//!   folders it created, innermost first, while they are still empty (`fs.rmdir`, which names this
//!   inverse and is no bridge method).
//!
//! An undo or redo runs as the stack's entry says, under the cmd:invoke scope core_undo checked,
//! and never overwrites: a way back that is taken is `already_exists`, and the entry stays.

use std::io;

use desk_bridge::{BridgeError, ErrorCode, UndoEntry};
use desk_sys::fs as sysfs;
use serde_json::{Map, Value, json};

use super::moves::sys;
use super::ops::{created_paths, not_a_root};
use crate::handler::{Core, error};

const RENAME: &str = "fs.rename";
const COPY: &str = "fs.copy";
const MKDIR: &str = "fs.mkdir";
const TRASH: &str = "fs.trash";
const RMDIR: &str = "fs.rmdir";

#[derive(Clone, Copy)]
enum Op {
    Rename,
    Copy,
    Mkdir,
}

/// Which of the three `entry` is, by its command and its inverse.
fn op_of(entry: &UndoEntry) -> Option<Op> {
    match (entry.command.as_str(), entry.inverse.as_str()) {
        (RENAME, RENAME) => Some(Op::Rename),
        (COPY, TRASH) => Some(Op::Copy),
        (MKDIR, RMDIR) => Some(Op::Mkdir),
        _ => None,
    }
}

/// Whether `entry` is a file operation's, undone and redone here.
pub(crate) fn is_fs_op(entry: &UndoEntry) -> bool {
    op_of(entry).is_some()
}

impl Core {
    pub(super) fn push_rename(&self, caller: &str, from: &str, to: &str, crossed: bool) {
        let result = json!({ "crossedDevices": crossed });
        self.push_fs_op(caller, RENAME, ends(from, to), result, RENAME);
    }

    pub(super) fn push_copy(&self, caller: &str, from: &str, to: &str, bytes: u64) {
        let result = json!({ "bytesCopied": bytes });
        self.push_fs_op(caller, COPY, ends(from, to), result, TRASH);
    }

    pub(super) fn push_mkdir(&self, caller: &str, path: &str, parents: bool, created: &[String]) {
        let mut args = Map::new();
        args.insert("path".to_owned(), json!(path));
        args.insert("parents".to_owned(), json!(parents));
        self.push_fs_op(caller, MKDIR, args, json!({ "created": created }), RMDIR);
    }

    fn push_fs_op(&self, caller: &str, command: &str, args: Args, result: Value, inverse: &str) {
        let entry = self.command_entry(command, Some(args), Some(result), caller, inverse);
        self.push_undo(entry, true);
    }

    /// Undo `entry`: rename it back, move the copy to the trash, or remove the new folders.
    pub(crate) fn undo_fs_op(&self, entry: &UndoEntry) -> Result<(), BridgeError> {
        match op_of(entry) {
            Some(Op::Rename) => {
                let (from, to) = (self.arg_path(entry, "from")?, self.arg_path(entry, "to")?);
                self.move_path(&to, &from).map(|_| ())
            }
            Some(Op::Copy) => self.trash_path(&self.arg_path(entry, "to")?),
            Some(Op::Mkdir) => self.remove_created(entry),
            None => Err(not_ours(entry)),
        }
    }

    /// Run `entry` again: the entry to put back on the undo side, with what this run answered.
    pub(crate) fn redo_fs_op(&self, entry: &UndoEntry) -> Result<UndoEntry, BridgeError> {
        let op = op_of(entry).ok_or_else(|| not_ours(entry))?;
        let result = match op {
            Op::Rename | Op::Copy => {
                let (from, to) = (self.arg_path(entry, "from")?, self.arg_path(entry, "to")?);
                if let Op::Rename = op {
                    json!({ "crossedDevices": self.move_path(&from, &to)? })
                } else {
                    json!({ "bytesCopied": sysfs::copy(&from, &to).map_err(sys)? })
                }
            }
            Op::Mkdir => {
                let bridge = not_a_root(&arg(entry, "path")?)?;
                let parents = args_of(entry).get("parents").and_then(Value::as_bool);
                let made = sysfs::mkdir(&self.resolve(&bridge)?, parents.unwrap_or(false));
                json!({ "created": created_paths(&bridge, made.map_err(sys)?.len()) })
            }
        };
        let mut next = entry.clone();
        next.result = Some(result);
        Ok(next)
    }

    /// Remove the folders a mkdir created, innermost first. The innermost must be empty (else
    /// `invalid_params`, and nothing is removed); an outer one that holds something else now stays.
    fn remove_created(&self, entry: &UndoEntry) -> Result<(), BridgeError> {
        let created: Vec<String> = entry
            .result
            .as_ref()
            .and_then(|result| result.get("created"))
            .and_then(Value::as_array)
            .map(|paths| paths.iter().filter_map(Value::as_str).map(str::to_owned))
            .into_iter()
            .flatten()
            .collect();
        for (n, path) in created.iter().rev().enumerate() {
            // remove_dir removes only an empty folder: the OS checks, not a race with a listing.
            match std::fs::remove_dir(self.resolve(path)?) {
                Ok(()) => {}
                Err(err) if err.kind() == io::ErrorKind::NotFound => {}
                Err(err) if n == 0 => {
                    let why = format!("{path} stays: it is not an empty folder any more ({err})");
                    return Err(error(ErrorCode::InvalidParams, why));
                }
                Err(_) => break,
            }
        }
        Ok(())
    }

    /// The file system path of the bridge path `entry.args[key]`.
    fn arg_path(&self, entry: &UndoEntry, key: &str) -> Result<std::path::PathBuf, BridgeError> {
        self.resolve(&arg(entry, key)?)
    }
}

type Args = Map<String, Value>;

fn ends(from: &str, to: &str) -> Args {
    let mut args = Map::new();
    args.insert("from".to_owned(), json!(from));
    args.insert("to".to_owned(), json!(to));
    args
}

fn args_of(entry: &UndoEntry) -> Args {
    entry.args.clone().unwrap_or_default()
}

/// The string `entry.args[key]`: an entry the core pushed always has it.
fn arg(entry: &UndoEntry, key: &str) -> Result<String, BridgeError> {
    args_of(entry)
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            let why = format!("the {} entry has no {key}", entry.command);
            error(ErrorCode::Internal, why)
        })
}

fn not_ours(entry: &UndoEntry) -> BridgeError {
    let why = format!("{} is not a file operation", entry.command);
    error(ErrorCode::Internal, why)
}
