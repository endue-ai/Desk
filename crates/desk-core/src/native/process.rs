//! A native plugin's process (Unix): started with two stream sockets it inherits, the surface
//! connection and the bridge connection, named in its environment; watched until it ends. The desk
//! keeps the other ends: the shell speaks `specs/surface` on the first, the core serves the bridge on
//! the second as the plugin (`bridge.rs`). Stopping closes both, which asks the process to exit, and
//! kills it once its grace has passed.
#![allow(unsafe_code)]

use std::io;
use std::net::Shutdown;
use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream;
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use desk_surface::env;

use super::{Ended, Exit, NativeLaunch};
use crate::handler::Core;

/// How often the watcher looks whether the process ended.
const LOOK: Duration = Duration::from_millis(20);

struct Watched {
    child: Mutex<Child>,
    /// The desk asked it to stop.
    asked: AtomicBool,
    /// It ended (the watcher saw it).
    ended: AtomicBool,
}

impl Watched {
    fn child(&self) -> MutexGuard<'_, Child> {
        self.child.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// A running native plugin. Dropping it stops it.
pub struct NativeProcess {
    watched: Arc<Watched>,
    pid: u32,
    grace: Duration,
    /// The desk's end of the surface connection, until the shell takes it.
    surface: Option<UnixStream>,
    /// Kept to close the connections when it stops.
    closers: Vec<UnixStream>,
}

impl NativeProcess {
    /// Start `launch` with `extra` in its environment (the shell's Mach service on macOS). The
    /// bridge connection is served as the plugin from now on; `ended` hears once how it ended.
    pub fn start(
        core: &Arc<Core>,
        launch: &NativeLaunch,
        extra: &[(String, String)],
        ended: impl FnOnce(Ended) + Send + 'static,
    ) -> io::Result<NativeProcess> {
        let (surface, surface_child) = UnixStream::pair()?;
        let (bridge, bridge_child) = UnixStream::pair()?;
        let fds = [surface_child.as_raw_fd(), bridge_child.as_raw_fd()];
        let mut command = Command::new(&launch.program);
        command
            .args(&launch.args)
            .current_dir(&launch.dir)
            .stdin(Stdio::null())
            .env(env::PLUGIN_ID, &launch.plugin)
            .env(env::SURFACE_FD, fds[0].to_string())
            .env(env::BRIDGE_FD, fds[1].to_string())
            .envs(extra.iter().map(|(k, v)| (k, v)));
        // SAFETY: runs in the child between fork and exec, and calls only fcntl, which is
        // async-signal-safe, on two descriptors the child inherited open. Every descriptor Rust
        // makes is close-on-exec; these two alone must survive the exec.
        unsafe {
            command.pre_exec(move || {
                for fd in fds {
                    if libc::fcntl(fd, libc::F_SETFD, 0) == -1 {
                        return Err(io::Error::last_os_error());
                    }
                }
                Ok(())
            });
        }
        let child = command.spawn()?;
        // The child's ends are the child's now: the desk keeps its own.
        drop((surface_child, bridge_child));
        let pid = child.id();
        let closers = vec![surface.try_clone()?, bridge.try_clone()?];
        super::bridge::serve(Arc::clone(core), launch.plugin.clone(), bridge)?;
        let watched = Arc::new(Watched {
            child: Mutex::new(child),
            asked: AtomicBool::new(false),
            ended: AtomicBool::new(false),
        });
        watch(Arc::clone(&watched), ended)?;
        Ok(NativeProcess {
            watched,
            pid,
            grace: launch.grace,
            surface: Some(surface),
            closers,
        })
    }

    /// The process id.
    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// The desk's end of the surface connection (once).
    pub fn take_surface(&mut self) -> Option<UnixStream> {
        self.surface.take()
    }

    /// Whether the process ended.
    pub fn has_ended(&self) -> bool {
        self.watched.ended.load(Ordering::SeqCst)
    }

    /// Ask it to stop: both connections close, and it is killed if it still runs after its grace.
    pub fn stop(&self) {
        if self.watched.asked.swap(true, Ordering::SeqCst) {
            return;
        }
        for stream in &self.closers {
            let _ = stream.shutdown(Shutdown::Both);
        }
        let watched = Arc::clone(&self.watched);
        let grace = self.grace;
        let _ = thread::Builder::new()
            .name("desk-native-stop".to_owned())
            .spawn(move || {
                let until = Instant::now() + grace;
                while Instant::now() < until {
                    if watched.ended.load(Ordering::SeqCst) {
                        return;
                    }
                    thread::sleep(LOOK);
                }
                if !watched.ended.load(Ordering::SeqCst) {
                    let _ = watched.child().kill();
                }
            });
    }

    /// Kill it now (the desk quits, or the person stopped it).
    pub fn kill(&self) {
        self.watched.asked.store(true, Ordering::SeqCst);
        for stream in &self.closers {
            let _ = stream.shutdown(Shutdown::Both);
        }
        if !self.watched.ended.load(Ordering::SeqCst) {
            let _ = self.watched.child().kill();
        }
    }
}

impl Drop for NativeProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Watch the process until it ends, then say how.
fn watch(watched: Arc<Watched>, ended: impl FnOnce(Ended) + Send + 'static) -> io::Result<()> {
    thread::Builder::new()
        .name("desk-native-watch".to_owned())
        .spawn(move || {
            let status = loop {
                match watched.child().try_wait() {
                    Ok(Some(status)) => break Some(status),
                    Ok(None) => {}
                    Err(_) => break None,
                }
                thread::sleep(LOOK);
            };
            watched.ended.store(true, Ordering::SeqCst);
            let exit = status.map(exit_of).unwrap_or(Exit::Code(-1));
            ended(Ended {
                exit,
                asked: watched.asked.load(Ordering::SeqCst),
            });
        })
        .map(drop)
}

fn exit_of(status: ExitStatus) -> Exit {
    match (status.code(), status.signal()) {
        (Some(code), _) => Exit::Code(code),
        (None, Some(signal)) => Exit::Signal(signal),
        (None, None) => Exit::Code(-1),
    }
}
