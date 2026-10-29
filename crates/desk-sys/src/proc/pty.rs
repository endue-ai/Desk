//! A process in a PTY (portable-pty): one merged output stream, typed input, a resizable size.

use std::io::{self, Write as _};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{CommandBuilder, MasterPty, native_pty_system};

use super::events::{self, Message, OnEvent};
use super::{PtySize, Signal, SpawnOptions, Stream};
use crate::{Error, ErrorCode};

pub(super) struct Pty {
    /// None once the program has exited on Windows, where the console is then closed.
    master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
    writer: Arc<Mutex<Box<dyn io::Write + Send>>>,
    child: child::Handle,
}

pub(super) fn spawn(
    program: &Path,
    cwd: &Path,
    options: &SpawnOptions,
    size: PtySize,
    on_event: OnEvent,
) -> Result<(Option<u32>, Pty), Error> {
    let pair = native_pty_system()
        .openpty(pty_size(size))
        .map_err(|err| pty_error(err, "open a PTY"))?;
    let mut command = CommandBuilder::new(program);
    command.args(&options.args);
    // portable-pty would start in the home folder; match the pipe mode instead.
    command.cwd(cwd);
    for (key, value) in &options.env {
        command.env(key, value);
    }
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|err| pty_error(err, &options.program))?;
    // The parent's copy of the slave side must close, or the PTY never reports its end.
    drop(pair.slave);
    let pid = child.process_id();
    let (handle, wait) = child::own(child)?;
    let pty = Pty {
        master: Arc::new(Mutex::new(None)),
        writer: Arc::new(Mutex::new(Box::new(io::sink()))),
        child: handle,
    };
    // From here on, dropping `pty` on an error would leave the child running: kill it first.
    let failed = |err: Error| {
        let _ = pty.kill(Signal::Kill);
        err
    };
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|err| failed(pty_error(err, "read the PTY")))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|err| failed(pty_error(err, "write the PTY")))?;
    *pty.master.lock().unwrap_or_else(|e| e.into_inner()) = Some(pair.master);
    *pty.writer.lock().unwrap_or_else(|e| e.into_inner()) = writer;
    #[cfg(windows)]
    let reader = super::conpty::Handshake::new(reader, Arc::clone(&pty.writer));

    let sender = events::start(1, on_event).map_err(|err| failed(Error::io(&err, "events")))?;
    events::read(reader, Stream::Pty, sender.clone())
        .map_err(|err| failed(Error::io(&err, "events")))?;
    let console = Arc::clone(&pty.master);
    thread::Builder::new()
        .name("desk-proc-wait".to_owned())
        .spawn(move || {
            let exit = wait();
            // A Windows console outlives its program: closing it sends the last frame and ends the
            // output. On unix the output ends once the program and its children let go of the PTY.
            if cfg!(windows) {
                let master = console.lock().unwrap_or_else(|e| e.into_inner()).take();
                drop(master);
            }
            let _ = sender.send(Message::Exited(exit));
        })
        .map_err(|err| failed(Error::io(&err, "events")))?;
    Ok((pid, pty))
}

impl Pty {
    pub(super) fn write(&self, data: &[u8]) -> Result<(), Error> {
        let mut writer = self.writer.lock().unwrap_or_else(|e| e.into_inner());
        writer
            .write_all(data)
            .and_then(|()| writer.flush())
            .map_err(|err| Error::io(&err, "the PTY"))
    }

    /// After the program has exited there is nothing left to resize; that is not an error.
    pub(super) fn resize(&self, size: PtySize) -> Result<(), Error> {
        let master = self.master.lock().unwrap_or_else(|e| e.into_inner());
        let Some(master) = master.as_ref() else {
            return Ok(());
        };
        master
            .resize(pty_size(size))
            .map_err(|err| pty_error(err, "resize the PTY"))
    }

    pub(super) fn kill(&self, signal: Signal) -> Result<(), Error> {
        self.child.kill(signal)
    }
}

fn pty_size(size: PtySize) -> portable_pty::PtySize {
    portable_pty::PtySize {
        rows: size.rows,
        cols: size.cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// portable-pty reports `anyhow` errors; keep the OS error's code when there is one.
fn pty_error(
    err: impl Into<Box<dyn std::error::Error + Send + Sync>>,
    context: impl std::fmt::Display,
) -> Error {
    let err = err.into();
    match err.downcast_ref::<io::Error>() {
        Some(io) => Error::io(io, context),
        None => Error::new(ErrorCode::IoError, format!("{context}: {err}")),
    }
}

/// Owning the child: on unix portable-pty hands back a `std` child, which `shared_child` waits on
/// and signals without racing its reaping. On Windows the child is a process handle.
#[cfg(unix)]
mod child {
    use std::sync::Arc;

    use shared_child::SharedChild;

    use super::super::{Exit, Signal, exit_of, signal_child};
    use crate::{Error, ErrorCode};

    pub(super) struct Handle(Arc<SharedChild>);

    pub(super) fn own(
        child: Box<dyn portable_pty::Child + Send + Sync>,
    ) -> Result<(Handle, impl FnOnce() -> Exit + Send + 'static), Error> {
        let child: Box<dyn portable_pty::Child> = child;
        let child = match child.downcast::<std::process::Child>() {
            Ok(child) => *child,
            Err(mut child) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(Error::new(
                    ErrorCode::Internal,
                    "portable-pty returned a child of an unknown type",
                ));
            }
        };
        let child =
            Arc::new(SharedChild::new(child).map_err(|err| Error::io(&err, "the PTY child"))?);
        let waited = Arc::clone(&child);
        Ok((Handle(child), move || {
            waited.wait().map(exit_of).unwrap_or_default()
        }))
    }

    impl Handle {
        pub(super) fn kill(&self, signal: Signal) -> Result<(), Error> {
            signal_child(&self.0, signal).map_err(|err| Error::io(&err, "kill"))
        }
    }
}

#[cfg(windows)]
mod child {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    use portable_pty::ChildKiller;

    use super::super::{Exit, Signal};
    use crate::Error;

    pub(super) struct Handle {
        killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
        exited: Arc<AtomicBool>,
    }

    pub(super) fn own(
        mut child: Box<dyn portable_pty::Child + Send + Sync>,
    ) -> Result<(Handle, impl FnOnce() -> Exit + Send + 'static), Error> {
        let exited = Arc::new(AtomicBool::new(false));
        let handle = Handle {
            killer: Mutex::new(child.clone_killer()),
            exited: Arc::clone(&exited),
        };
        Ok((handle, move || {
            let code = child.wait().map(|status| status.exit_code() as i32).ok();
            exited.store(true, Ordering::SeqCst);
            Exit { code, signal: None }
        }))
    }

    impl Handle {
        /// Windows has no signals: each one terminates the process. The killer holds the process
        /// handle, so the id cannot be reused under it.
        ///
        /// portable-pty 0.9's `WinChildKiller::kill` reads `TerminateProcess` the wrong way round: it
        /// returns `Err(last OS error)` when the call succeeds (a stale error such as "The handle is
        /// invalid") and `Ok(())` when it fails. Its result is read here as it really is.
        pub(super) fn kill(&self, _signal: Signal) -> Result<(), Error> {
            if self.exited.load(Ordering::SeqCst) {
                return Ok(());
            }
            let result = self.killer.lock().unwrap_or_else(|e| e.into_inner()).kill();
            match result {
                Err(_) => Ok(()),
                Ok(()) if self.exited.load(Ordering::SeqCst) => Ok(()),
                Ok(()) => Err(Error::io(
                    &std::io::Error::other("TerminateProcess failed"),
                    "kill",
                )),
            }
        }
    }
}
