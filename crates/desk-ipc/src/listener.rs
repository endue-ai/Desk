//! `Listener`: the desk's end of the socket. It binds the path (replacing a socket file a crashed desk
//! left), makes it the owner's only, accepts connections on its own thread and removes the file when
//! dropped.

use std::fs::{self, Permissions};
use std::io;
use std::os::unix::fs::{FileTypeExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use desk_core::Core;

use crate::serve::{self, Clients};

/// Serves the desk socket for as long as it lives.
pub struct Listener {
    path: PathBuf,
    stop: Arc<AtomicBool>,
    clients: Clients,
}

impl Listener {
    /// Bind `path` and serve `core` on it: every connection is the caller `cli` and hears every core
    /// event. `AddrInUse` when another desk serves the path or the path is not a socket.
    pub fn bind(path: &Path, core: Arc<Core>) -> io::Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let socket = claim(path)?;
        // Before the first accept: the kernel then refuses `connect` to anyone but the owner.
        if let Err(why) = fs::set_permissions(path, Permissions::from_mode(0o600)) {
            let _ = fs::remove_file(path);
            return Err(why);
        }
        let listener = Self {
            path: path.to_owned(),
            stop: Arc::new(AtomicBool::new(false)),
            clients: Clients::default(),
        };
        serve::fan_out(
            core.events().subscribe(),
            listener.clients.clone(),
            Arc::clone(&listener.stop),
        )?;
        let stop = Arc::clone(&listener.stop);
        let clients = listener.clients.clone();
        thread::Builder::new()
            .name("desk-ipc-accept".to_owned())
            .spawn(move || accept(&socket, &core, &clients, &stop))?;
        Ok(listener)
    }

    /// The socket path this listener serves.
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        // Wake the accept thread so it sees `stop`; then nothing answers on the path.
        let _ = UnixStream::connect(&self.path);
        self.clients.close_all();
        let _ = fs::remove_file(&self.path);
    }
}

fn accept(socket: &UnixListener, core: &Arc<Core>, clients: &Clients, stop: &AtomicBool) {
    let mut next = 0;
    for stream in socket.incoming() {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        match stream {
            Ok(stream) => {
                next += 1;
                let _ = serve::connection(stream, next, Arc::clone(core), clients);
            }
            // Out of file descriptors and the like: wait a little rather than spin.
            Err(_) => thread::sleep(Duration::from_millis(50)),
        }
    }
}

/// Bind `path`. A socket file nothing answers on is a crashed desk's: remove it and bind again.
fn claim(path: &Path) -> io::Result<UnixListener> {
    match UnixListener::bind(path) {
        Err(why) if why.kind() == io::ErrorKind::AddrInUse => {}
        bound => return bound,
    }
    let is_socket = fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_socket());
    if !is_socket {
        return Err(in_use(path, "exists and is not a socket"));
    }
    match UnixStream::connect(path) {
        Ok(_) => Err(in_use(path, "is served by another desk")),
        Err(why) if why.kind() == io::ErrorKind::ConnectionRefused => {
            fs::remove_file(path)?;
            UnixListener::bind(path)
        }
        Err(why) => Err(why),
    }
}

fn in_use(path: &Path, why: &str) -> io::Error {
    io::Error::new(
        io::ErrorKind::AddrInUse,
        format!("{} {why}", path.display()),
    )
}
