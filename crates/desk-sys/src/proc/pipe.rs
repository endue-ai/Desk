//! A process on plain pipes: stdin, stdout and stderr apart.

use std::io::Write as _;
use std::path::Path;
use std::process::{ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use shared_child::SharedChild;

use super::events::{self, Message, OnEvent};
use super::{Signal, SpawnOptions, Stream, exit_of, signal_child};
use crate::{Error, ErrorCode};

pub(super) struct Pipe {
    child: Arc<SharedChild>,
    stdin: Mutex<Option<ChildStdin>>,
}

pub(super) fn spawn(
    program: &Path,
    cwd: &Path,
    options: &SpawnOptions,
    on_event: OnEvent,
) -> Result<(Option<u32>, Pipe), Error> {
    let mut command = Command::new(program);
    command
        .args(&options.args)
        .current_dir(cwd)
        .envs(&options.env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child =
        SharedChild::spawn(&mut command).map_err(|err| Error::io(&err, &options.program))?;
    let child = Arc::new(child);
    let pipe = Pipe {
        child: Arc::clone(&child),
        stdin: Mutex::new(child.take_stdin()),
    };
    // If a thread cannot start, the child must not outlive the failed spawn, nor stay a zombie.
    let failed = |err: std::io::Error| {
        let _ = child.kill();
        let _ = child.wait();
        Error::io(&err, &options.program)
    };
    let sender = events::start(2, on_event).map_err(failed)?;
    if let Some(stdout) = child.take_stdout() {
        events::read(stdout, Stream::Stdout, sender.clone()).map_err(failed)?;
    } else {
        let _ = sender.send(Message::Closed);
    }
    if let Some(stderr) = child.take_stderr() {
        events::read(stderr, Stream::Stderr, sender.clone()).map_err(failed)?;
    } else {
        let _ = sender.send(Message::Closed);
    }
    let waited = Arc::clone(&child);
    thread::Builder::new()
        .name("desk-proc-wait".to_owned())
        .spawn(move || {
            // `wait` reaps the child; a failed wait still ends the event stream.
            let exit = waited.wait().map(exit_of).unwrap_or_default();
            let _ = sender.send(Message::Exited(exit));
        })
        .map_err(failed)?;
    Ok((Some(child.id()), pipe))
}

impl Pipe {
    pub(super) fn write(&self, data: &[u8]) -> Result<(), Error> {
        let mut stdin = self.stdin.lock().unwrap_or_else(|e| e.into_inner());
        let Some(stdin) = stdin.as_mut() else {
            return Err(Error::new(ErrorCode::IoError, "stdin is closed"));
        };
        stdin
            .write_all(data)
            .and_then(|()| stdin.flush())
            .map_err(|err| Error::io(&err, "stdin"))
    }

    pub(super) fn kill(&self, signal: Signal) -> Result<(), Error> {
        signal_child(&self.child, signal).map_err(|err| Error::io(&err, "kill"))
    }
}

impl Drop for Pipe {
    fn drop(&mut self) {
        // Close stdin so a program reading it sees the end.
        self.stdin
            .get_mut()
            .unwrap_or_else(|e| e.into_inner())
            .take();
    }
}
