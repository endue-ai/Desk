//! The process side of `Core`: proc.spawn, proc.write, proc.resize and proc.kill, with proc.output
//! and proc.exit events. Later calls on a process need a scope that still covers its command.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, Weak};

use base64::Engine as _;
use desk_bridge::{
    BridgeError, BridgeEvent, Encoding, ErrorCode, OutputStream, Permission, ProcExitData,
    ProcExitEvent, ProcKillParams, ProcKillResult, ProcOutputData, ProcOutputEvent,
    ProcResizeParams, ProcResizeResult, ProcSpawnParams, ProcSpawnPermission, ProcSpawnResult,
    ProcWriteParams, ProcWriteResult, Signal,
};
use desk_sys::proc::{self as sysproc, Exit, Process, Size, Spec, Stream};

use crate::events::EventBus;
use crate::handler::{Answer, Core, denied, error, io_error, json};
use crate::perm::{Denied, Target};
use crate::resources::Table;

/// A process the core started, with the command its scope must keep covering.
pub(crate) struct Running {
    command: String,
    process: Arc<Process>,
}

pub(crate) type Procs = Arc<Mutex<Table<Running>>>;

impl Core {
    pub(crate) fn proc_spawn(&self, caller: &str, params: ProcSpawnParams) -> Answer {
        let wants_pty = params.pty.is_some();
        let scope = Permission::ProcSpawn(params.scope);
        if wants_pty && !matches!(&scope, Permission::ProcSpawn(s) if s.pty == Some(true)) {
            return Err(denied(Denied {
                permission: scope,
                reason: "the scope does not allow a pseudo-terminal".to_owned(),
            }));
        }
        let grant = self
            .permissions()
            .authorize(caller, &scope, &Target::Command(&params.command))
            .map_err(denied)?;
        let cwd = match &params.cwd {
            Some(path) => self.resolve(path)?,
            None => self.home(),
        };
        let spec = Spec {
            program: params.command.clone(),
            args: params.args.unwrap_or_default(),
            cwd: Some(cwd),
            env: params.env.unwrap_or_default().into_iter().collect(),
            pty: params.pty.map(|size| Size {
                cols: u16::try_from(size.cols).unwrap_or(u16::MAX),
                rows: u16::try_from(size.rows).unwrap_or(u16::MAX),
            }),
        };
        // Held until the process is stored, so its exit cannot be handled before it is known.
        let mut procs = lock(&self.procs);
        let proc_id = procs.next_id();
        let (on_output, on_exit) = reporters(&proc_id, self.events(), Arc::downgrade(&self.procs));
        let process = sysproc::spawn(spec, on_output, on_exit).map_err(|e| {
            error(
                ErrorCode::IoError,
                format!("{} did not start: {e}", params.command),
            )
        })?;
        let pid = process.pid().map(u64::from);
        let running = Running {
            command: params.command,
            process: Arc::new(process),
        };
        procs.insert(proc_id.clone(), caller, &grant, running);
        json(ProcSpawnResult { proc_id, pid })
    }

    pub(crate) fn proc_write(&self, caller: &str, params: ProcWriteParams) -> Answer {
        let process = self.process(caller, &params.proc_id, params.scope)?;
        let bytes = match params.encoding.unwrap_or(Encoding::Utf8) {
            Encoding::Utf8 => params.data.into_bytes(),
            Encoding::Base64 => base64::engine::general_purpose::STANDARD
                .decode(params.data)
                .map_err(|e| error(ErrorCode::InvalidParams, format!("data is not base64: {e}")))?,
        };
        process.write(&bytes).map_err(io_error)?;
        json(ProcWriteResult {})
    }

    pub(crate) fn proc_resize(&self, caller: &str, params: ProcResizeParams) -> Answer {
        let process = self.process(caller, &params.proc_id, params.scope)?;
        let size = Size {
            cols: u16::try_from(params.size.cols).unwrap_or(u16::MAX),
            rows: u16::try_from(params.size.rows).unwrap_or(u16::MAX),
        };
        process.resize(size).map_err(|e| match e.kind() {
            std::io::ErrorKind::Unsupported => error(ErrorCode::Unsupported, e.to_string()),
            _ => io_error(e),
        })?;
        json(ProcResizeResult {})
    }

    pub(crate) fn proc_kill(&self, caller: &str, params: ProcKillParams) -> Answer {
        let process = self.process(caller, &params.proc_id, params.scope)?;
        let signal = match params.signal.unwrap_or(Signal::Term) {
            Signal::Term => sysproc::Signal::Term,
            Signal::Kill => sysproc::Signal::Kill,
            Signal::Int => sysproc::Signal::Int,
            Signal::Hup => sysproc::Signal::Hup,
        };
        process.signal(signal).map_err(io_error)?;
        json(ProcKillResult {})
    }

    /// The caller's process `id`, when the scope still covers its command.
    fn process(
        &self,
        caller: &str,
        id: &str,
        scope: ProcSpawnPermission,
    ) -> Result<Arc<Process>, BridgeError> {
        let (command, process) = {
            let mut procs = lock(&self.procs);
            let running = procs
                .get_mut(caller, id)
                .ok_or_else(|| error(ErrorCode::NotFound, format!("no process {id}")))?;
            (running.command.clone(), running.process.clone())
        };
        self.permissions()
            .authorize(
                caller,
                &Permission::ProcSpawn(scope),
                &Target::Command(&command),
            )
            .map_err(denied)?;
        Ok(process)
    }
}

/// The callbacks of one process: output as proc.output events (text split only at whole UTF-8
/// characters), then proc.exit, then the process leaves the table.
fn reporters(
    proc_id: &str,
    events: &EventBus,
    procs: Weak<Mutex<Table<Running>>>,
) -> (
    impl Fn(Stream, &[u8]) + Send + Sync + 'static,
    impl FnOnce(Exit) + Send + 'static,
) {
    let chunks = Arc::new(Mutex::new(Chunks::default()));
    let (out_id, out_events, out_chunks) = (proc_id.to_owned(), events.clone(), chunks.clone());
    let on_output = move |stream: Stream, bytes: &[u8]| {
        let chunk = lock(&out_chunks).push(stream, bytes);
        if let Some((data, encoding)) = chunk {
            out_events.publish(output(&out_id, stream, data, encoding));
        }
    };
    let (exit_id, exit_events) = (proc_id.to_owned(), events.clone());
    let on_exit = move |exit: Exit| {
        for (stream, data) in lock(&chunks).flush() {
            exit_events.publish(output(&exit_id, stream, data, Encoding::Base64));
        }
        exit_events.publish(BridgeEvent::ProcExit(ProcExitEvent {
            event: Default::default(),
            data: ProcExitData {
                proc_id: exit_id.clone(),
                code: exit.code.map(i64::from),
                signal: exit.signal.map(|signal| match signal {
                    sysproc::Signal::Term => Signal::Term,
                    sysproc::Signal::Kill => Signal::Kill,
                    sysproc::Signal::Int => Signal::Int,
                    sysproc::Signal::Hup => Signal::Hup,
                }),
            },
        }));
        if let Some(procs) = procs.upgrade() {
            lock(&procs).forget(&exit_id);
        }
    };
    (on_output, on_exit)
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

/// Output text per stream: a character split across two reads waits for its other half; bytes that
/// are not UTF-8 go out as base64.
#[derive(Default)]
pub(crate) struct Chunks {
    pending: HashMap<Stream, Vec<u8>>,
}

impl Chunks {
    pub fn push(&mut self, stream: Stream, bytes: &[u8]) -> Option<(String, Encoding)> {
        let mut buffer = self.pending.remove(&stream).unwrap_or_default();
        buffer.extend_from_slice(bytes);
        match String::from_utf8(buffer) {
            Ok(text) => (!text.is_empty()).then_some((text, Encoding::Utf8)),
            Err(e) if e.utf8_error().error_len().is_none() => {
                let valid = e.utf8_error().valid_up_to();
                let mut bytes = e.into_bytes();
                self.pending.insert(stream, bytes.split_off(valid));
                let text = String::from_utf8(bytes).ok()?;
                (!text.is_empty()).then_some((text, Encoding::Utf8))
            }
            Err(e) => Some((
                base64::engine::general_purpose::STANDARD.encode(e.into_bytes()),
                Encoding::Base64,
            )),
        }
    }

    /// Bytes still waiting when the process ended, as base64.
    pub fn flush(&mut self) -> Vec<(Stream, String)> {
        self.pending
            .drain()
            .filter(|(_, bytes)| !bytes.is_empty())
            .map(|(stream, bytes)| {
                (
                    stream,
                    base64::engine::general_purpose::STANDARD.encode(bytes),
                )
            })
            .collect()
    }
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
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
        assert!(chunks.flush().is_empty());
    }

    #[test]
    fn bytes_that_are_not_utf8_go_out_as_base64() {
        let mut chunks = Chunks::default();
        assert_eq!(
            chunks.push(Stream::Pty, &[0xff, 0x00]),
            Some(("/wA=".to_owned(), Encoding::Base64))
        );
        chunks.push(Stream::Pty, &[0xe2]);
        assert_eq!(chunks.flush(), vec![(Stream::Pty, "4g==".to_owned())]);
    }
}
