//! The desk socket (ADR 0030): the desk CLI and the person's scripts reach this desk as the caller
//! `cli` over a Unix socket in the data folder that only the same OS user can open.

use std::io;
use std::sync::{Arc, Mutex};

use desk_core::Core;
use desk_ipc::{CALLER, Listener};

/// Keeps the socket served for the life of the app; dropping it removes the socket file.
pub struct Serving(#[allow(dead_code)] pub Mutex<Option<Listener>>);

/// Grant `cli` what ADR 0030 lists, then serve the socket. When it cannot be served (another desk
/// serves it, Windows) the reason is logged in one line and the desk runs on without it.
pub fn serve(core: &Arc<Core>) -> Serving {
    for permission in desk_ipc::grants() {
        core.grant(CALLER, permission);
    }
    let Some(path) = desk_ipc::socket_path() else {
        eprintln!(
            "endue Desk: no data folder for the desk socket; the desk CLI cannot reach this desk"
        );
        return Serving(Mutex::new(None));
    };
    let listener = match Listener::bind(&path, Arc::clone(core)) {
        Ok(listener) => {
            eprintln!(
                "endue Desk: the desk CLI reaches this desk at {}",
                path.display()
            );
            Some(listener)
        }
        Err(why) if why.kind() == io::ErrorKind::Unsupported => {
            eprintln!("endue Desk: {why}");
            None
        }
        Err(why) => {
            eprintln!("endue Desk: no desk socket ({why}); the desk CLI cannot reach this desk");
            None
        }
    };
    Serving(Mutex::new(listener))
}
