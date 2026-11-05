//! Changes: a `cli` connection hears the desk's events, and a command registered, updated or removed
//! or a plugin installed, changed or removed tells the client its lists changed, once per burst:
//! `notifications/tools/list_changed` when commands have tools of their own, and
//! `notifications/resources/list_changed`. The desk starting or stopping is a change too; while it is
//! down the watch tries again every two seconds. Nothing is sent before the client is initialized.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::Duration;

use desk_bridge::BridgeEvent;

use crate::desk::Desk;
use crate::rpc::{Out, notification};

const RETRY: Duration = Duration::from_secs(2);
/// How long a burst of changes (a plugin registering its commands) may pause and still be one.
const BURST: Duration = Duration::from_millis(150);

#[derive(Clone, Copy, Default)]
struct Change {
    tools: bool,
    resources: bool,
}

const EVERYTHING: Change = Change {
    tools: true,
    resources: true,
};

/// Whether the client may hear notifications yet, and whether the session ended.
#[derive(Clone, Default)]
pub(crate) struct Flags {
    pub(crate) ready: Arc<AtomicBool>,
    pub(crate) stop: Arc<AtomicBool>,
}

/// Watch the desk for the session; `tools` says whether the list of tools can change.
pub(crate) fn start(desk: Arc<Desk>, out: Out, tools: bool, flags: Flags) {
    let (changes, heard) = mpsc::channel();
    let stop = Arc::clone(&flags.stop);
    let _ = thread::Builder::new()
        .name("desk-mcp-watch".to_owned())
        .spawn(move || listen(&desk, &changes, &stop));
    let _ = thread::Builder::new()
        .name("desk-mcp-notify".to_owned())
        .spawn(move || notify(&heard, &out, tools, &flags));
}

fn listen(desk: &Desk, changes: &Sender<Change>, stop: &AtomicBool) {
    let mut up = false;
    while !stop.load(Ordering::SeqCst) {
        let Ok(mut conn) = desk.cli() else {
            if std::mem::take(&mut up) && changes.send(EVERYTHING).is_err() {
                return;
            }
            thread::sleep(RETRY);
            continue;
        };
        if !std::mem::replace(&mut up, true) && changes.send(EVERYTHING).is_err() {
            return;
        }
        while let Ok(event) = conn.next_event() {
            let change = match event {
                BridgeEvent::CmdChanged(_) => Change {
                    tools: true,
                    resources: false,
                },
                BridgeEvent::PluginChanged(_) => EVERYTHING,
                _ => continue,
            };
            if stop.load(Ordering::SeqCst) || changes.send(change).is_err() {
                return;
            }
        }
    }
}

fn notify(heard: &Receiver<Change>, out: &Out, tools: bool, flags: &Flags) {
    while let Ok(mut change) = heard.recv() {
        loop {
            match heard.recv_timeout(BURST) {
                Ok(more) => {
                    change.tools |= more.tools;
                    change.resources |= more.resources;
                }
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        if flags.stop.load(Ordering::SeqCst) {
            return;
        }
        if !flags.ready.load(Ordering::SeqCst) {
            continue;
        }
        let mut sent = Ok(());
        if tools && change.tools {
            sent = out.send(&notification("notifications/tools/list_changed"));
        }
        if change.resources && sent.is_ok() {
            sent = out.send(&notification("notifications/resources/list_changed"));
        }
        if sent.is_err() {
            return;
        }
    }
}
