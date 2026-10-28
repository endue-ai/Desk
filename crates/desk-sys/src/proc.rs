//! Process primitives: programs started without a shell, with pipes or in a pseudo-terminal
//! (portable-pty). No permission checks happen here: desk-core authorizes every call first.

use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize};

/// How often the waiter looks at a running process.
const POLL: Duration = Duration::from_millis(20);
/// How long output may keep arriving after the process ended (children that kept the pipe open).
const DRAIN: Duration = Duration::from_secs(1);

/// What to start.
#[derive(Debug, Clone, Default)]
pub struct Spec {
    /// A program name looked up on PATH, or an absolute path.
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    /// Added to the inherited environment.
    pub env: Vec<(String, String)>,
    /// Present: run in a pseudo-terminal of this size.
    pub pty: Option<Size>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Size {
    pub cols: u16,
    pub rows: u16,
}

/// Where output came from. A pseudo-terminal merges stdout and stderr.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Stream {
    Stdout,
    Stderr,
    Pty,
}

/// Portable signals. Windows ends the process for every one of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Signal {
    Term,
    Kill,
    Int,
    Hup,
}

/// How a process ended: an exit code, or the signal that ended it (when it is one of the four).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Exit {
    pub code: Option<i32>,
    pub signal: Option<Signal>,
}

/// What signals and resizes go through. Unix signals by process id, so it uses only the master.
enum Control {
    Pipes(#[cfg_attr(unix, allow(dead_code))] Arc<Mutex<std::process::Child>>),
    Pty {
        master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
        #[cfg_attr(unix, allow(dead_code))]
        killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    },
}

/// A running (or finished) process. Dropping it kills a process that is still running.
pub struct Process {
    pid: Option<u32>,
    input: Mutex<Option<Box<dyn Write + Send>>>,
    control: Control,
    exited: Arc<AtomicBool>,
}

/// Start `spec`. `on_output` gets every chunk as it is read; `on_exit` runs once, after the output.
pub fn spawn(
    spec: Spec,
    on_output: impl Fn(Stream, &[u8]) + Send + Sync + 'static,
    on_exit: impl FnOnce(Exit) + Send + 'static,
) -> io::Result<Process> {
    match spec.pty {
        Some(size) => spawn_pty(spec, size, Arc::new(on_output), on_exit),
        None => spawn_pipes(spec, Arc::new(on_output), on_exit),
    }
}

type Sink = Arc<dyn Fn(Stream, &[u8]) + Send + Sync>;

fn spawn_pipes(
    spec: Spec,
    sink: Sink,
    on_exit: impl FnOnce(Exit) + Send + 'static,
) -> io::Result<Process> {
    use std::process::{Command, Stdio};
    let mut command = Command::new(&spec.program);
    command
        .args(&spec.args)
        .envs(spec.env.iter().map(|(k, v)| (k, v)))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = &spec.cwd {
        command.current_dir(cwd);
    }
    let mut child = command.spawn()?;
    let pid = Some(child.id());
    let input = child
        .stdin
        .take()
        .map(|w| Box::new(w) as Box<dyn Write + Send>);
    let (done, readers) = mpsc::channel();
    if let Some(out) = child.stdout.take() {
        read_into(out, Stream::Stdout, sink.clone(), done.clone())?;
    }
    if let Some(err) = child.stderr.take() {
        read_into(err, Stream::Stderr, sink, done)?;
    }
    let child = Arc::new(Mutex::new(child));
    let exited = Arc::new(AtomicBool::new(false));
    let (waited, flag) = (child.clone(), exited.clone());
    thread::Builder::new()
        .name("desk-proc-wait".to_owned())
        .spawn(move || {
            let exit = loop {
                match lock(&waited).try_wait() {
                    Ok(Some(status)) => break exit_of(status),
                    Ok(None) => thread::sleep(POLL),
                    Err(_) => break Exit::default(),
                }
            };
            flag.store(true, Ordering::SeqCst);
            drain(&readers, DRAIN);
            on_exit(exit);
        })?;
    Ok(Process {
        pid,
        input: Mutex::new(input),
        control: Control::Pipes(child),
        exited,
    })
}

fn spawn_pty(
    spec: Spec,
    size: Size,
    sink: Sink,
    on_exit: impl FnOnce(Exit) + Send + 'static,
) -> io::Result<Process> {
    let pair = portable_pty::native_pty_system()
        .openpty(pty_size(size))
        .map_err(io::Error::other)?;
    let mut builder = CommandBuilder::new(&spec.program);
    builder.args(&spec.args);
    if let Some(cwd) = &spec.cwd {
        builder.cwd(cwd);
    }
    for (key, value) in &spec.env {
        builder.env(key, value);
    }
    let mut child = pair
        .slave
        .spawn_command(builder)
        .map_err(io::Error::other)?;
    // Our copy of the terminal's other end must close, or reading never sees the end.
    drop(pair.slave);
    let pid = child.process_id();
    let killer = child.clone_killer();
    let reader = pair.master.try_clone_reader().map_err(io::Error::other)?;
    let writer = pair.master.take_writer().map_err(io::Error::other)?;
    let (done, readers) = mpsc::channel();
    read_into(reader, Stream::Pty, sink, done)?;
    let master = Arc::new(Mutex::new(Some(pair.master)));
    let exited = Arc::new(AtomicBool::new(false));
    let (closing, flag) = (master.clone(), exited.clone());
    thread::Builder::new()
        .name("desk-pty-wait".to_owned())
        .spawn(move || {
            let exit = loop {
                match child.try_wait() {
                    Ok(Some(status)) => break pty_exit_of(&status),
                    Ok(None) => thread::sleep(POLL),
                    Err(_) => break Exit::default(),
                }
            };
            flag.store(true, Ordering::SeqCst);
            // Some platforms (ConPTY) end the output only once the terminal itself is closed.
            if !drain(&readers, DRAIN / 4) {
                lock(&closing).take();
                drain(&readers, DRAIN);
            }
            lock(&closing).take();
            on_exit(exit);
        })?;
    Ok(Process {
        pid,
        input: Mutex::new(Some(writer)),
        control: Control::Pty {
            master,
            killer: Mutex::new(killer),
        },
        exited,
    })
}

impl Process {
    /// The OS process id, when known.
    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    pub fn has_exited(&self) -> bool {
        self.exited.load(Ordering::SeqCst)
    }

    /// Write to stdin, or to the terminal.
    pub fn write(&self, bytes: &[u8]) -> io::Result<()> {
        let mut input = lock(&self.input);
        let input = input
            .as_mut()
            .ok_or_else(|| io::Error::from(io::ErrorKind::BrokenPipe))?;
        input.write_all(bytes)?;
        input.flush()
    }

    /// Resize the terminal. Processes without one answer `Unsupported`.
    pub fn resize(&self, size: Size) -> io::Result<()> {
        match &self.control {
            Control::Pipes(_) => Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "the process has no terminal",
            )),
            Control::Pty { master, .. } => lock(master)
                .as_ref()
                .ok_or_else(|| io::Error::other("the process has ended"))?
                .resize(pty_size(size))
                .map_err(io::Error::other),
        }
    }

    /// Send `signal`. A process that already ended is left alone.
    pub fn signal(&self, signal: Signal) -> io::Result<()> {
        if self.has_exited() {
            return Ok(());
        }
        #[cfg(unix)]
        {
            use nix::sys::signal::{Signal as S, kill};
            let pid = self.pid.ok_or_else(|| io::Error::other("no process id"))?;
            let sig = match signal {
                Signal::Term => S::SIGTERM,
                Signal::Kill => S::SIGKILL,
                Signal::Int => S::SIGINT,
                Signal::Hup => S::SIGHUP,
            };
            let pid = nix::unistd::Pid::from_raw(i32::try_from(pid).map_err(io::Error::other)?);
            kill(pid, sig).map_err(io::Error::from)
        }
        #[cfg(not(unix))]
        {
            let _ = signal;
            match &self.control {
                Control::Pipes(child) => lock(child).kill(),
                Control::Pty { killer, .. } => lock(killer).kill(),
            }
        }
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.signal(Signal::Kill);
    }
}

/// Read `from` until it ends, handing each chunk to `sink`; report the end on `done`.
fn read_into(
    mut from: impl Read + Send + 'static,
    stream: Stream,
    sink: Sink,
    done: mpsc::Sender<()>,
) -> io::Result<()> {
    thread::Builder::new()
        .name("desk-proc-read".to_owned())
        .spawn(move || {
            let mut buffer = [0u8; 8192];
            loop {
                match from.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => sink(stream, &buffer[..n]),
                }
            }
            let _ = done.send(());
        })
        .map(drop)
}

/// Wait up to `limit` for every reader to finish. Returns whether they all did.
fn drain(readers: &Receiver<()>, limit: Duration) -> bool {
    let deadline = Instant::now() + limit;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match readers.recv_timeout(left) {
            Ok(()) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return true,
            Err(mpsc::RecvTimeoutError::Timeout) => return false,
        }
    }
}

fn pty_size(size: Size) -> PtySize {
    PtySize {
        rows: size.rows,
        cols: size.cols,
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn exit_of(status: std::process::ExitStatus) -> Exit {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(number) = status.signal() {
            let signal = match number {
                1 => Some(Signal::Hup),
                2 => Some(Signal::Int),
                9 => Some(Signal::Kill),
                15 => Some(Signal::Term),
                _ => None,
            };
            return Exit { code: None, signal };
        }
    }
    Exit {
        code: status.code(),
        signal: None,
    }
}

/// portable-pty names signals the way strsignal does ("Terminated", "Killed: 9").
fn pty_exit_of(status: &portable_pty::ExitStatus) -> Exit {
    match status.signal() {
        Some(name) => {
            let signal = [
                ("Hangup", Signal::Hup),
                ("Interrupt", Signal::Int),
                ("Killed", Signal::Kill),
                ("Terminated", Signal::Term),
            ]
            .into_iter()
            .find(|(prefix, _)| name.starts_with(prefix))
            .map(|(_, signal)| signal);
            Exit { code: None, signal }
        }
        None => Exit {
            code: i32::try_from(status.exit_code()).ok(),
            signal: None,
        },
    }
}

fn lock<T: ?Sized>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
