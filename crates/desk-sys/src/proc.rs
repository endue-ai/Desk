//! Process primitives: spawn a program without a shell, in pipes or a PTY, write to it, resize the
//! PTY, signal it, and hear its output and exit. No permission checks happen here: desk-core
//! authorizes every call first.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::{Error, ErrorCode};

mod events;
mod pipe;
mod program;
mod pty;

/// What to start. The program runs directly, never through a shell, with the arguments as given.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SpawnOptions {
    /// A program name looked up on PATH, or a path to the program.
    pub program: String,
    pub args: Vec<String>,
    /// The working folder; the caller's when absent.
    pub cwd: Option<PathBuf>,
    /// Added to the caller's environment.
    pub env: BTreeMap<String, String>,
    /// Run in a PTY of this size. Output then arrives on `Stream::Pty`.
    pub pty: Option<PtySize>,
}

/// A terminal size in character cells.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PtySize {
    pub cols: u16,
    pub rows: u16,
}

/// Where output came from. A PTY merges stdout and stderr.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Stream {
    Stdout,
    Stderr,
    Pty,
}

/// Portable signal names. On Windows every one of them terminates the process.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Signal {
    Term,
    Kill,
    Int,
    Hup,
}

/// How a process ended: an exit code, or the signal that ended it. A signal outside `Signal` is
/// reported as code 128 + its number, the way shells do.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Exit {
    pub code: Option<i32>,
    pub signal: Option<Signal>,
}

/// What a running process reports, in order. `Exit` is always the last event.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Output { stream: Stream, data: Vec<u8> },
    Exit(Exit),
}

/// A running process. Dropping it kills the process (`Signal::Kill`); it is reaped either way, and
/// its `Exit` event still arrives.
pub struct Process {
    pid: Option<u32>,
    inner: Inner,
}

enum Inner {
    Pipe(pipe::Pipe),
    Pty(pty::Pty),
}

/// Start a process. `on_event` runs on a thread of its own and receives the output, then the exit;
/// it is dropped after the exit.
pub fn spawn(
    options: &SpawnOptions,
    on_event: impl FnMut(Event) + Send + 'static,
) -> Result<Process, Error> {
    validate(options)?;
    let cwd = match &options.cwd {
        Some(cwd) => cwd.clone(),
        None => std::env::current_dir().map_err(|err| Error::io(&err, "the current folder"))?,
    };
    let program = program::resolve(&options.program, &cwd, &options.env)?;
    let (pid, inner) = match options.pty {
        None => {
            let (pid, pipe) = pipe::spawn(&program, &cwd, options, Box::new(on_event))?;
            (pid, Inner::Pipe(pipe))
        }
        Some(size) => {
            let (pid, pty) = pty::spawn(&program, &cwd, options, size, Box::new(on_event))?;
            (pid, Inner::Pty(pty))
        }
    };
    Ok(Process { pid, inner })
}

impl Process {
    /// The OS process id, when known.
    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    /// Write to the process's stdin, or type into its PTY.
    pub fn write(&self, data: &[u8]) -> Result<(), Error> {
        match &self.inner {
            Inner::Pipe(pipe) => pipe.write(data),
            Inner::Pty(pty) => pty.write(data),
        }
    }

    /// Resize the PTY. A process started without one gives `unsupported`.
    pub fn resize(&self, size: PtySize) -> Result<(), Error> {
        check_size(size)?;
        match &self.inner {
            Inner::Pipe(_) => Err(Error::new(
                ErrorCode::Unsupported,
                "the process was started without a PTY",
            )),
            Inner::Pty(pty) => pty.resize(size),
        }
    }

    /// Send `signal`. Signalling a process that has already exited does nothing.
    pub fn kill(&self, signal: Signal) -> Result<(), Error> {
        match &self.inner {
            Inner::Pipe(pipe) => pipe.kill(signal),
            Inner::Pty(pty) => pty.kill(signal),
        }
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.kill(Signal::Kill);
    }
}

fn validate(options: &SpawnOptions) -> Result<(), Error> {
    let invalid = |why: String| Err(Error::new(ErrorCode::InvalidParams, why));
    if options.program.is_empty() || options.program.contains('\0') {
        return invalid(format!("bad program name {:?}", options.program));
    }
    if options.args.iter().any(|arg| arg.contains('\0')) {
        return invalid("an argument holds a NUL byte".to_owned());
    }
    for (key, value) in &options.env {
        if key.is_empty() || key.contains(['=', '\0']) || value.contains('\0') {
            return invalid(format!("bad environment variable {key:?}"));
        }
    }
    if let Some(size) = options.pty {
        check_size(size)?;
    }
    if let Some(cwd) = &options.cwd {
        check_cwd(cwd)?;
    }
    Ok(())
}

fn check_size(size: PtySize) -> Result<(), Error> {
    if size.cols == 0 || size.rows == 0 {
        return Err(Error::new(
            ErrorCode::InvalidParams,
            format!("a PTY needs at least one column and one row, not {size:?}"),
        ));
    }
    Ok(())
}

fn check_cwd(cwd: &Path) -> Result<(), Error> {
    match std::fs::metadata(cwd) {
        Ok(meta) if meta.is_dir() => Ok(()),
        Ok(_) => Err(Error::new(
            ErrorCode::InvalidParams,
            format!("{}: not a folder", cwd.display()),
        )),
        Err(err) => Err(Error::io(&err, cwd.display())),
    }
}

/// The exit of a process the OS reports with a `std` status.
fn exit_of(status: std::process::ExitStatus) -> Exit {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt as _;
        if let Some(number) = status.signal() {
            let signal = match number {
                libc::SIGTERM => Signal::Term,
                libc::SIGKILL => Signal::Kill,
                libc::SIGINT => Signal::Int,
                libc::SIGHUP => Signal::Hup,
                other => {
                    return Exit {
                        code: Some(128 + other),
                        signal: None,
                    };
                }
            };
            return Exit {
                code: None,
                signal: Some(signal),
            };
        }
    }
    Exit {
        code: status.code(),
        signal: None,
    }
}

/// Send `signal` to a child that `shared_child` owns, race-free against its reaping.
fn signal_child(child: &shared_child::SharedChild, signal: Signal) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use shared_child::unix::SharedChildExt as _;
        let number = match signal {
            Signal::Term => libc::SIGTERM,
            Signal::Kill => libc::SIGKILL,
            Signal::Int => libc::SIGINT,
            Signal::Hup => libc::SIGHUP,
        };
        child.send_signal(number)
    }
    #[cfg(not(unix))]
    {
        let _ = signal;
        child.kill()
    }
}
