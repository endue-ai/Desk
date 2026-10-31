//! The proc side of `Core`: proc.spawn, proc.write, proc.resize and proc.kill, with `proc.output`
//! and `proc.exit` events for the caller that started the process. A process belongs to its caller:
//! later calls need a scope that still covers its command, another caller's id is `not_found`, and
//! the process ends when the caller unloads or its grants no longer cover the command (a revoke),
//! as a watch does. Output goes out as UTF-8 text split only at whole characters; bytes that are
//! not text go out as base64.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex, MutexGuard, Weak};

use base64::Engine as _;
use desk_bridge::{
    BridgeError, BridgeEvent, Encoding, ErrorCode, OutputStream, Permission, ProcExitData,
    ProcExitEvent, ProcKillParams, ProcKillResult, ProcOutputData, ProcOutputEvent,
    ProcResizeParams, ProcResizeResult, ProcSpawnParams, ProcSpawnPermission, ProcSpawnResult,
    ProcWriteParams, ProcWriteResult, Signal,
};
use desk_sys::proc::{self as sysproc, Event, Process, SpawnOptions, Stream};

use crate::events::EventBus;
use crate::handler::{Answer, Core, denied, error, json, sys_error};
use crate::perm::{Denied, Target};

struct ProcEntry {
    caller: String,
    scope: Permission,
    command: String,
    process: Process,
}

/// The processes callers started, by id. Shared with each process's reporter, which removes the
/// entry once the process has ended.
#[derive(Default)]
pub(crate) struct Processes {
    next: u64,
    entries: BTreeMap<String, ProcEntry>,
}

impl Core {
    pub(crate) fn proc_spawn(&self, caller: &str, params: ProcSpawnParams) -> Answer {
        let scope = Permission::ProcSpawn(params.scope);
        if params.pty.is_some()
            && !matches!(&scope, Permission::ProcSpawn(s) if s.pty == Some(true))
        {
            return Err(denied(Denied {
                permission: scope,
                reason: "the scope does not allow a pseudo-terminal".to_owned(),
            }));
        }
        self.check(caller, &scope, &Target::Command(&params.command))?;
        let cwd = match &params.cwd {
            Some(path) => self.resolve(path)?,
            None => self.home().to_path_buf(),
        };
        let options = SpawnOptions {
            program: params.command.clone(),
            args: params.args.unwrap_or_default(),
            cwd: Some(cwd),
            env: params.env.unwrap_or_default(),
            pty: params.pty.map(size_of),
        };
        // The table stays locked until the process is stored, so an exit that comes at once still
        // finds the entry it removes.
        let mut processes = lock(&self.processes);
        processes.next += 1;
        let proc_id = format!("p-{}", processes.next);
        let report = reporter(
            proc_id.clone(),
            caller,
            self.events().clone(),
            Arc::downgrade(&self.processes),
        );
        let process = sysproc::spawn(&options, report).map_err(sys_error)?;
        let pid = process.pid().map(u64::from);
        processes.entries.insert(
            proc_id.clone(),
            ProcEntry {
                caller: caller.to_owned(),
                scope,
                command: params.command,
                process,
            },
        );
        drop(processes);
        json(ProcSpawnResult { proc_id, pid })
    }

    pub(crate) fn proc_write(&self, caller: &str, params: ProcWriteParams) -> Answer {
        let bytes = match params.encoding.unwrap_or(Encoding::Utf8) {
            Encoding::Utf8 => params.data.into_bytes(),
            Encoding::Base64 => base64::engine::general_purpose::STANDARD
                .decode(params.data)
                .map_err(|e| error(ErrorCode::InvalidParams, format!("not base64: {e}")))?,
        };
        self.with_process(caller, &params.proc_id, params.scope, |process| {
            process.write(&bytes)
        })?;
        json(ProcWriteResult {})
    }

    pub(crate) fn proc_resize(&self, caller: &str, params: ProcResizeParams) -> Answer {
        let size = size_of(params.size);
        self.with_process(caller, &params.proc_id, params.scope, |process| {
            process.resize(size)
        })?;
        json(ProcResizeResult {})
    }

    pub(crate) fn proc_kill(&self, caller: &str, params: ProcKillParams) -> Answer {
        let signal = match params.signal.unwrap_or(Signal::Term) {
            Signal::Term => sysproc::Signal::Term,
            Signal::Kill => sysproc::Signal::Kill,
            Signal::Int => sysproc::Signal::Int,
            Signal::Hup => sysproc::Signal::Hup,
        };
        self.with_process(caller, &params.proc_id, params.scope, |process| {
            process.kill(signal)
        })?;
        json(ProcKillResult {})
    }

    /// Run `act` on the caller's process `id`, once `scope` has passed the permission check for the
    /// process's command. Another caller's process, or one that has ended, is `not_found`.
    fn with_process(
        &self,
        caller: &str,
        id: &str,
        scope: ProcSpawnPermission,
        act: impl FnOnce(&Process) -> Result<(), desk_sys::Error>,
    ) -> Result<(), BridgeError> {
        let missing = || error(ErrorCode::NotFound, format!("{caller} has no process {id}"));
        let command = lock(&self.processes)
            .entries
            .get(id)
            .filter(|entry| entry.caller == caller)
            .map(|entry| entry.command.clone())
            .ok_or_else(missing)?;
        // Not under the table's lock: a spent once grant prunes the table from inside the check.
        self.check(
            caller,
            &Permission::ProcSpawn(scope),
            &Target::Command(&command),
        )?;
        let processes = lock(&self.processes);
        let entry = processes
            .entries
            .get(id)
            .filter(|entry| entry.caller == caller)
            .ok_or_else(missing)?;
        act(&entry.process).map_err(sys_error)
    }

    /// The caller unloaded: its processes end.
    pub(crate) fn drop_processes(&self, caller: &str) {
        let ended = take(&mut lock(&self.processes), |entry| entry.caller == caller);
        drop(ended);
    }

    /// End the caller's processes that its grants no longer cover.
    pub(crate) fn prune_processes(&self, caller: &str) {
        let ended = {
            let mut processes = lock(&self.processes);
            let permissions = self.permissions();
            take(&mut processes, |entry| {
                entry.caller == caller
                    && permissions
                        .authorize(caller, &entry.scope, &Target::Command(&entry.command))
                        .is_err()
            })
        };
        drop(ended);
    }

    /// How many processes are running, for tests and diagnostics.
    pub fn process_count(&self) -> usize {
        lock(&self.processes).entries.len()
    }
}

/// Remove the entries `ends` picks and hand back their processes, to be dropped (killed) once the
/// table is unlocked.
fn take(processes: &mut Processes, ends: impl Fn(&ProcEntry) -> bool) -> Vec<Process> {
    let ids: Vec<String> = processes
        .entries
        .iter()
        .filter(|(_, entry)| ends(entry))
        .map(|(id, _)| id.clone())
        .collect();
    ids.iter()
        .filter_map(|id| processes.entries.remove(id))
        .map(|entry| entry.process)
        .collect()
}

/// The callback of one process: its output as `proc.output` events for the caller, then its exit as
/// `proc.exit`, once the entry has left the table.
fn reporter(
    proc_id: String,
    caller: &str,
    events: EventBus,
    processes: Weak<Mutex<Processes>>,
) -> impl FnMut(Event) + Send + 'static {
    let to = vec![caller.to_owned()];
    let mut chunks = Chunks::default();
    move |event| match event {
        Event::Output { stream, data } => {
            if let Some((data, encoding)) = chunks.push(stream, &data) {
                events.publish_to(to.clone(), output(&proc_id, stream, data, encoding));
            }
        }
        Event::Exit(exit) => {
            if let Some(processes) = processes.upgrade() {
                lock(&processes).entries.remove(&proc_id);
            }
            for (stream, data) in chunks.flush() {
                events.publish_to(to.clone(), output(&proc_id, stream, data, Encoding::Base64));
            }
            let signal = exit.signal.map(|signal| match signal {
                sysproc::Signal::Term => Signal::Term,
                sysproc::Signal::Kill => Signal::Kill,
                sysproc::Signal::Int => Signal::Int,
                sysproc::Signal::Hup => Signal::Hup,
            });
            events.publish_to(
                to.clone(),
                BridgeEvent::ProcExit(ProcExitEvent {
                    event: Default::default(),
                    data: ProcExitData {
                        proc_id: proc_id.clone(),
                        code: exit.code.map(i64::from),
                        signal,
                    },
                }),
            );
        }
    }
}

fn output(proc_id: &str, stream: Stream, data: String, encoding: Encoding) -> BridgeEvent {
    BridgeEvent::ProcOutput(ProcOutputEvent {
        event: Default::default(),
        data: ProcOutputData {
            proc_id: proc_id.to_owned(),
            stream: match stream {
                Stream::Stdout => OutputStream::Stdout,
                Stream::Stderr => OutputStream::Stderr,
                Stream::Pty => OutputStream::Pty,
            },
            data,
            encoding,
        },
    })
}

/// Output per stream as text: a character split across two reads waits for its other half; bytes
/// that are not UTF-8 go out as base64, with whatever waited before them.
#[derive(Default)]
struct Chunks {
    pending: HashMap<Stream, Vec<u8>>,
}

impl Chunks {
    fn push(&mut self, stream: Stream, bytes: &[u8]) -> Option<(String, Encoding)> {
        let mut buffer = self.pending.remove(&stream).unwrap_or_default();
        buffer.extend_from_slice(bytes);
        match String::from_utf8(buffer) {
            Ok(text) => (!text.is_empty()).then_some((text, Encoding::Utf8)),
            Err(err) if err.utf8_error().error_len().is_none() => {
                let valid = err.utf8_error().valid_up_to();
                let mut bytes = err.into_bytes();
                self.pending.insert(stream, bytes.split_off(valid));
                let text = String::from_utf8(bytes).ok()?;
                (!text.is_empty()).then_some((text, Encoding::Utf8))
            }
            Err(err) => Some((
                base64::engine::general_purpose::STANDARD.encode(err.into_bytes()),
                Encoding::Base64,
            )),
        }
    }

    /// Bytes still waiting when the process ended, as base64.
    fn flush(&mut self) -> Vec<(Stream, String)> {
        let mut rest: Vec<(Stream, String)> = self
            .pending
            .drain()
            .filter(|(_, bytes)| !bytes.is_empty())
            .map(|(stream, bytes)| {
                (
                    stream,
                    base64::engine::general_purpose::STANDARD.encode(bytes),
                )
            })
            .collect();
        rest.sort_by_key(|(stream, _)| format!("{stream:?}"));
        rest
    }
}

fn size_of(size: desk_bridge::PtySize) -> sysproc::PtySize {
    let clamp = |n: u64| u16::try_from(n).unwrap_or(u16::MAX);
    sysproc::PtySize {
        cols: clamp(size.cols),
        rows: clamp(size.rows),
    }
}

pub(crate) fn lock(processes: &Mutex<Processes>) -> MutexGuard<'_, Processes> {
    processes
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_character_split_across_reads_waits_for_its_other_half() {
        let mut chunks = Chunks::default();
        let euro = "€".as_bytes();
        assert_eq!(
            chunks.push(Stream::Stdout, &[b'a', euro[0]]),
            Some(("a".to_owned(), Encoding::Utf8))
        );
        assert_eq!(
            chunks.push(Stream::Stderr, b"b"),
            Some(("b".to_owned(), Encoding::Utf8)),
            "streams are kept apart"
        );
        assert_eq!(
            chunks.push(Stream::Stdout, &euro[1..]),
            Some(("€".to_owned(), Encoding::Utf8))
        );
        assert_eq!(chunks.push(Stream::Stdout, &euro[..1]), None);
        assert!(chunks.push(Stream::Pty, b"").is_none());
        assert_eq!(chunks.flush(), vec![(Stream::Stdout, "4g==".to_owned())]);
    }

    #[test]
    fn bytes_that_are_not_utf8_go_out_as_base64() {
        let mut chunks = Chunks::default();
        assert_eq!(
            chunks.push(Stream::Pty, &[0xff, 0x00]),
            Some(("/wA=".to_owned(), Encoding::Base64))
        );
        assert_eq!(
            chunks.push(Stream::Pty, b"ok"),
            Some(("ok".to_owned(), Encoding::Utf8)),
            "a bad chunk does not poison the stream"
        );
    }
}
