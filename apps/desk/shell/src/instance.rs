//! One desk per person and data folder (#45, the Tauri shell's single-instance plugin): a second
//! start hands its arguments to the running desk and quits, so a file opened from Finder, Explorer or
//! a terminal lands in the desk already open. It runs before CEF starts, whose profile only one
//! process can hold.
//!
//! The lock is an OS file lock on `desk-instance.lock` in the data folder, which the OS lets go when
//! the desk exits however it exits, so a crash never leaves a stale lock. The running desk listens on
//! a loopback port named, with a random token, in `desk-instance.json` beside it (only the person's
//! own account can read that folder); a second start sends `{token, args, cwd}` as one JSON line and
//! waits for `ok`. A loopback port rather than `desk.sock`: the desk socket speaks only bridge
//! documents to `desk-cli` (ADR 0030), which stay as they are, and it has no Windows transport yet.

use std::fs::{File, OpenOptions, TryLockError};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

pub const LOCK_FILE: &str = "desk-instance.lock";
pub const INFO_FILE: &str = "desk-instance.json";
/// How long a second start waits for the running desk to answer (it may be starting itself).
pub const WAIT: Duration = Duration::from_secs(5);
/// The longest hand-off line a desk reads: arguments are paths, not contents.
const MAX_LINE: u64 = 256 * 1024;

/// What a second start hands over: its arguments (the program first) and its folder.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Handoff {
    pub args: Vec<String>,
    pub cwd: String,
}

impl Handoff {
    /// This process's own arguments and folder.
    pub fn this_process() -> Self {
        Self {
            args: std::env::args_os()
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect(),
            cwd: std::env::current_dir()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
        }
    }
}

/// How the claim went.
pub enum Claim {
    /// This process is the desk: later starts hand their arguments to it while this is held.
    First(Instance),
    /// The running desk took this start's arguments: quit.
    HandedOff,
}

/// Where the running desk listens.
#[derive(Serialize, Deserialize)]
struct Info {
    port: u16,
    token: String,
}

#[derive(Serialize, Deserialize)]
struct Message {
    token: String,
    #[serde(flatten)]
    handoff: Handoff,
}

/// The running desk's hold on being the only one; dropping it lets the next start have it.
pub struct Instance {
    _lock: File,
    info: PathBuf,
    port: u16,
    stop: Arc<AtomicBool>,
}

impl Drop for Instance {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = std::fs::remove_file(&self.info);
        // Wake the listener so its thread sees the stop.
        let _ = TcpStream::connect_timeout(&local(self.port), Duration::from_millis(200));
    }
}

/// Be the desk for `dir`, or hand `handoff` to the one that is. `on_handoff` hears every later
/// start's arguments, on a thread of its own.
pub fn claim(
    dir: &Path,
    handoff: &Handoff,
    on_handoff: impl Fn(Handoff) + Send + 'static,
) -> io::Result<Claim> {
    claim_within(dir, handoff, on_handoff, WAIT)
}

/// [`claim`], waiting at most `wait` for a running desk to answer.
pub fn claim_within(
    dir: &Path,
    handoff: &Handoff,
    on_handoff: impl Fn(Handoff) + Send + 'static,
    wait: Duration,
) -> io::Result<Claim> {
    std::fs::create_dir_all(dir)?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join(LOCK_FILE))?;
    match lock.try_lock() {
        Ok(()) => listen(lock, dir, on_handoff).map(Claim::First),
        Err(TryLockError::WouldBlock) => hand_off(dir, handoff, wait).map(|()| Claim::HandedOff),
        Err(TryLockError::Error(why)) => Err(why),
    }
}

fn listen(
    lock: File,
    dir: &Path,
    on_handoff: impl Fn(Handoff) + Send + 'static,
) -> io::Result<Instance> {
    let listener = TcpListener::bind(local(0))?;
    let port = listener.local_addr()?.port();
    let token = token()?;
    let info = dir.join(INFO_FILE);
    write_private(
        &info,
        &serde_json::to_vec(&Info {
            port,
            token: token.clone(),
        })?,
    )?;
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = Arc::clone(&stop);
    std::thread::Builder::new()
        .name("desk-instance".to_owned())
        .spawn(move || {
            for stream in listener.incoming() {
                if stopped.load(Ordering::SeqCst) {
                    return;
                }
                let Ok(stream) = stream else { continue };
                if let Some(handoff) = take(stream, &token) {
                    on_handoff(handoff);
                }
            }
        })?;
    Ok(Instance {
        _lock: lock,
        info,
        port,
        stop,
    })
}

/// Read one hand-off from `stream`; answer `ok` when its token is the desk's.
fn take(stream: TcpStream, token: &str) -> Option<Handoff> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut line = String::new();
    let mut reader = BufReader::new((&stream).take(MAX_LINE));
    reader.read_line(&mut line).ok()?;
    let message: Option<Message> = serde_json::from_str(line.trim_end()).ok();
    let mut writer = &stream;
    match message {
        Some(message) if same(&message.token, token) => {
            let _ = writer.write_all(b"ok\n");
            Some(message.handoff)
        }
        _ => {
            let _ = writer.write_all(b"refused\n");
            None
        }
    }
}

/// Send `handoff` to the running desk, retrying while it starts, until `wait` has passed.
fn hand_off(dir: &Path, handoff: &Handoff, wait: Duration) -> io::Result<()> {
    let deadline = Instant::now() + wait;
    loop {
        match send(dir, handoff) {
            Ok(()) => return Ok(()),
            Err(why) if Instant::now() >= deadline => {
                return Err(io::Error::new(
                    why.kind(),
                    format!(
                        "another desk holds {} but did not answer ({why})",
                        dir.display()
                    ),
                ));
            }
            Err(_) => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}

fn send(dir: &Path, handoff: &Handoff) -> io::Result<()> {
    let info: Info = serde_json::from_slice(&std::fs::read(dir.join(INFO_FILE))?)?;
    let stream = TcpStream::connect_timeout(&local(info.port), Duration::from_secs(1))?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    let message = Message {
        token: info.token,
        handoff: handoff.clone(),
    };
    let mut line = serde_json::to_vec(&message)?;
    line.push(b'\n');
    (&stream).write_all(&line)?;
    let mut answer = String::new();
    BufReader::new(&stream).read_line(&mut answer)?;
    match answer.trim() {
        "ok" => Ok(()),
        other => Err(io::Error::other(format!("the desk answered {other:?}"))),
    }
}

fn local(port: u16) -> SocketAddr {
    SocketAddr::from((Ipv4Addr::LOCALHOST, port))
}

/// 128 random bits as hex.
fn token() -> io::Result<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|why| io::Error::other(why.to_string()))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Compare without stopping at the first difference.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0, |all, (x, y)| all | (x ^ y))
            == 0
}

/// Write `bytes` to `path` whole (a partial file then a rename), readable by this account only.
fn write_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let partial = path.with_extension("json.partial");
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(&partial)?.write_all(bytes)?;
    std::fs::rename(&partial, path)
}

#[cfg(test)]
mod tests;
