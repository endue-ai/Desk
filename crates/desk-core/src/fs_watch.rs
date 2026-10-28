//! fs.watch: one notify watch per call, its changes coalesced for a moment and published as
//! `fs.changed` events with bridge paths.

use std::collections::BTreeSet;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use desk_bridge::{BridgeEvent, FsChange, FsChangedData, FsChangedEvent};
use desk_sys::fs::{self as sysfs, Change, ChangeKind};

use crate::events::EventBus;
use crate::paths::glob_match;

/// How long a burst of changes is gathered before it is published, duplicates removed.
const COALESCE: Duration = Duration::from_millis(50);

pub(crate) struct Spec {
    pub watch_id: String,
    pub root: PathBuf,
    /// `root` as the caller named it, normalised.
    pub bridge_root: String,
    /// The call's scope: a change is reported when its path, or the folder it is in, is inside.
    pub patterns: Vec<String>,
    pub recursive: bool,
    pub events: EventBus,
}

/// Start the watch. Dropping the returned `Watch` stops it; the publishing thread then ends.
pub(crate) fn start(spec: Spec) -> io::Result<sysfs::Watch> {
    let (sender, receiver) = mpsc::channel::<Change>();
    let watch = sysfs::watch_changes(&spec.root, spec.recursive, move |change| {
        let _ = sender.send(change);
    })?;
    thread::Builder::new()
        .name(format!("desk-fs-watch-{}", spec.watch_id))
        .spawn(move || publish(&spec, &receiver))?;
    Ok(watch)
}

fn publish(spec: &Spec, receiver: &mpsc::Receiver<Change>) {
    // Platforms report canonical paths (macOS: /private/var for /var), so strip either form.
    let canonical = spec
        .root
        .canonicalize()
        .unwrap_or_else(|_| spec.root.clone());
    loop {
        let first = match receiver.recv() {
            Ok(change) => change,
            Err(_) => return,
        };
        let mut burst = vec![first];
        let mut open = true;
        while open {
            match receiver.recv_timeout(COALESCE) {
                Ok(change) => burst.push(change),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => open = false,
            }
        }
        let mut seen = BTreeSet::new();
        for change in burst {
            let Some(path) = bridge_path(spec, &canonical, &change.path) else {
                continue;
            };
            if !reportable(&spec.patterns, &path) || !seen.insert((path.clone(), change.kind as u8))
            {
                continue;
            }
            spec.events.publish(BridgeEvent::FsChanged(FsChangedEvent {
                event: Default::default(),
                data: FsChangedData {
                    watch_id: spec.watch_id.clone(),
                    path,
                    change: match change.kind {
                        ChangeKind::Created => FsChange::Created,
                        ChangeKind::Modified => FsChange::Modified,
                        ChangeKind::Removed => FsChange::Removed,
                    },
                },
            }));
        }
        if !open {
            return;
        }
    }
}

/// The bridge path of a changed file: the watch's bridge root plus the path below the root.
fn bridge_path(spec: &Spec, canonical: &Path, changed: &Path) -> Option<String> {
    let rest = changed
        .strip_prefix(&spec.root)
        .or_else(|_| changed.strip_prefix(canonical))
        .ok()?;
    let mut path = spec.bridge_root.clone();
    for part in rest.components() {
        if !path.ends_with('/') {
            path.push('/');
        }
        path.push_str(&part.as_os_str().to_string_lossy());
    }
    Some(path)
}

/// Like fs.list: a path inside the scope, or an entry of a folder inside it.
fn reportable(patterns: &[String], path: &str) -> bool {
    let inside = |p: &str| patterns.iter().any(|pattern| glob_match(pattern, p));
    inside(path)
        || path
            .rsplit_once('/')
            .is_some_and(|(parent, _)| !parent.is_empty() && inside(parent))
}
