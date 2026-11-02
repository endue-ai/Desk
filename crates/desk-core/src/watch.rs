//! Hot reload: watch plugin folders and turn bursts of file events into one revision per plugin. User
//! themes are left to `Core::watch_themes`, which tells someone's edit from the core's own write.

use std::collections::BTreeSet;
use std::io;
use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Weak};
use std::thread;
use std::time::Duration;

use crate::handler::Core;

/// How long a plugin folder must be quiet before its change is reported.
const DEBOUNCE: Duration = Duration::from_millis(100);

/// Watches the plugin folders installed when it started, user themes aside. Dropping it stops the
/// watch.
pub struct PluginWatcher {
    _watches: Vec<desk_sys::fs::Watch>,
}

pub(crate) fn start(core: &Arc<Core>) -> io::Result<PluginWatcher> {
    let (sender, receiver) = mpsc::channel::<String>();
    let mut watches = Vec::new();
    // Both watchers seeing a user theme's folder would announce one change twice.
    let themes = core.themes_dir().ok();
    for (id, dir) in core.plugin_folders() {
        if themes.is_some() && dir.parent() == themes.as_deref() {
            continue;
        }
        let sender = sender.clone();
        watches.push(desk_sys::fs::watch(&dir, move |_path: PathBuf| {
            let _ = sender.send(id.clone());
        })?);
    }
    let weak: Weak<Core> = Arc::downgrade(core);
    thread::Builder::new()
        .name("desk-plugin-watch".to_owned())
        .spawn(move || debounce(receiver, weak))?;
    Ok(PluginWatcher { _watches: watches })
}

fn debounce(receiver: mpsc::Receiver<String>, core: Weak<Core>) {
    let mut pending = BTreeSet::new();
    loop {
        match receiver.recv_timeout(DEBOUNCE) {
            Ok(id) => {
                pending.insert(id);
            }
            Err(RecvTimeoutError::Timeout) => {
                if pending.is_empty() {
                    continue;
                }
                let Some(core) = core.upgrade() else { return };
                for id in std::mem::take(&mut pending) {
                    core.plugin_files_changed(&id);
                }
            }
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}
