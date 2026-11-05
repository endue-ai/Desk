//! Starting a server process over stdio. Its environment is cleared, then given the variables the
//! MCP SDKs pass by default and the ones `env` names, from the desk's own environment: a server
//! sees the tokens it was given and no others. An app started from the Finder has the system's
//! PATH, so the usual install folders come after the desk's own (as the local-agents plugin does,
//! ADR 0084), and the program is looked up on that PATH. Stopping kills the process.

use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

/// What the MCP SDKs pass to a server they start, besides what it is given.
#[cfg(not(windows))]
const INHERITED: &[&str] = &["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER"];
#[cfg(windows)]
const INHERITED: &[&str] = &[
    "APPDATA",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "PATH",
    "PROCESSOR_ARCHITECTURE",
    "PROGRAMFILES",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "USERNAME",
    "USERPROFILE",
];

/// Where programs and the node they run on are installed when the desk's PATH misses them.
#[cfg(not(windows))]
const USUAL: &[&str] = &[
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/snap/bin",
    "/home/linuxbrew/.linuxbrew/bin",
];
#[cfg(windows)]
const USUAL: &[&str] = &[];

/// The longest stderr line kept, in bytes.
const STDERR_LINE: usize = 2000;

/// One server to start: init.yaml's `mcp.servers.<name>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerConfig {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    /// Names of variables to pass from the desk's environment.
    pub env: Vec<String>,
}

impl ServerConfig {
    /// The command line and the variables passed, for people.
    pub fn describe(&self) -> String {
        let mut line = self.command.clone();
        for arg in &self.args {
            line.push(' ');
            line.push_str(arg);
        }
        if !self.env.is_empty() {
            line.push_str(&format!(", given {}", self.env.join(", ")));
        }
        line
    }
}

/// A running server process.
pub struct Server {
    child: Mutex<Child>,
}

impl Server {
    /// Start `config` in `cwd`. Its stderr goes to `log` a line at a time; its stdout and stdin are
    /// the connection's.
    pub fn spawn(
        config: &ServerConfig,
        cwd: &Path,
        log: impl FnMut(String) + Send + 'static,
    ) -> std::io::Result<(Self, ChildStdout, ChildStdin)> {
        let path = search_path();
        let program = resolve(&config.command, &path).ok_or_else(|| {
            let why = format!("{}: no such program", config.command);
            std::io::Error::new(std::io::ErrorKind::NotFound, why)
        })?;
        let mut command = Command::new(program);
        command
            .args(&config.args)
            .current_dir(cwd)
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for name in INHERITED
            .iter()
            .copied()
            .chain(config.env.iter().map(String::as_str))
        {
            if let Some(value) =
                std::env::var_os(name).filter(|v| !v.to_string_lossy().starts_with("()"))
            {
                command.env(name, value);
            }
        }
        command.env("PATH", &path);
        hide_window(&mut command);
        let mut child = command.spawn()?;
        let taken = (child.stdout.take(), child.stdin.take(), child.stderr.take());
        let (Some(stdout), Some(stdin), Some(stderr)) = taken else {
            let _ = child.kill();
            return Err(std::io::Error::other("the server's stdio is not piped"));
        };
        thread::Builder::new()
            .name("desk-mcp-client-stderr".to_owned())
            .spawn(move || forward(stderr, log))?;
        let server = Self {
            child: Mutex::new(child),
        };
        Ok((server, stdout, stdin))
    }

    /// The process id.
    pub fn pid(&self) -> u32 {
        self.child().id()
    }

    /// Wait up to `grace` for the process to exit (after its input was closed), then kill it, and
    /// reap it. Its stdout ends, so the connection closes.
    pub fn stop(&self, grace: Duration) {
        let deadline = Instant::now() + grace;
        let mut child = self.child();
        while Instant::now() < deadline && matches!(child.try_wait(), Ok(None)) {
            thread::sleep(Duration::from_millis(20));
        }
        let _ = child.kill();
        let _ = child.wait();
    }

    /// Whether the process has ended.
    pub fn ended(&self) -> bool {
        matches!(self.child().try_wait(), Ok(Some(_)))
    }

    fn child(&self) -> MutexGuard<'_, Child> {
        self.child
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop(Duration::ZERO);
    }
}

/// The desk's PATH, then the usual folders it leaves out.
fn search_path() -> OsString {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();
    for usual in USUAL.iter().map(PathBuf::from) {
        if !dirs.contains(&usual) {
            dirs.push(usual);
        }
    }
    std::env::join_paths(dirs).unwrap_or_default()
}

/// A program with a folder separator is a path; a bare name is looked up on `path` (with each
/// PATHEXT extension on Windows).
fn resolve(program: &str, path: &OsString) -> Option<PathBuf> {
    let candidates = |base: PathBuf| {
        let mut list = vec![base.clone()];
        if cfg!(windows) {
            let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
            for ext in exts.split(';').filter(|e| !e.is_empty()) {
                let mut name = base.as_os_str().to_owned();
                name.push(ext);
                list.push(PathBuf::from(name));
            }
        }
        list
    };
    if program.contains('/') || (cfg!(windows) && program.contains('\\')) {
        return candidates(PathBuf::from(program))
            .into_iter()
            .find(|c| c.is_file());
    }
    std::env::split_paths(path)
        .filter(|dir| !dir.as_os_str().is_empty())
        .flat_map(|dir| candidates(dir.join(program)))
        .find(|candidate| candidate.is_file())
}

fn forward(stderr: impl std::io::Read, mut log: impl FnMut(String)) {
    let mut reader = BufReader::new(stderr);
    let mut line = Vec::new();
    let mut next = |line: &mut Vec<u8>| (&mut reader).take(64 * 1024).read_until(b'\n', line);
    while matches!(next(&mut line), Ok(n) if n > 0) {
        let mut text = String::from_utf8_lossy(&line).trim_end().to_owned();
        if text.len() > STDERR_LINE {
            let cut = (0..=STDERR_LINE).rev().find(|i| text.is_char_boundary(*i));
            text.truncate(cut.unwrap_or(0));
        }
        if !text.is_empty() {
            log(text);
        }
        line.clear();
    }
}

#[cfg(windows)]
fn hide_window(command: &mut Command) {
    use std::os::windows::process::CommandExt as _;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_window(_command: &mut Command) {}
