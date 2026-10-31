//! The views folder watched both ways: a view file written, rewritten or deleted by hand is a
//! `view.changed`, as view.save and view.remove are, and the core's own writes are not announced
//! twice. Like `PluginWatcher`, a debounced desk-sys watch on a thread holding the core weakly.

use std::collections::BTreeSet;
use std::io;
use std::sync::{Arc, Weak};
use std::time::Duration;

use desk_sys::fs::{WatchOptions, watch_debounced};

use crate::handler::Core;

/// How long the folder must be quiet before its changes are looked at.
const DEBOUNCE: Duration = Duration::from_millis(100);

/// Watches `~/.desk/views` from when it started. Dropping it stops the watch.
pub struct ViewWatcher {
    _watch: desk_sys::fs::Watch,
}

impl Core {
    /// Watch the views folder (creating it when missing) until the watcher drops.
    pub fn watch_views(self: &Arc<Self>) -> io::Result<ViewWatcher> {
        let folder = self.views_folder();
        std::fs::create_dir_all(&folder)?;
        self.remember_views();
        let core: Weak<Core> = Arc::downgrade(self);
        let options = WatchOptions {
            recursive: false,
            debounce: DEBOUNCE,
        };
        let watch = watch_debounced(&folder, options, move |batch| {
            let Some(core) = core.upgrade() else { return };
            let ids: BTreeSet<String> = batch
                .iter()
                .filter_map(|changed| {
                    let name = changed.path.file_name()?.to_string_lossy().into_owned();
                    let id = name.strip_suffix(".yaml")?;
                    (!id.starts_with('.')).then(|| id.to_owned())
                })
                .collect();
            for id in ids {
                core.view_file_changed(&id);
            }
        })?;
        Ok(ViewWatcher { _watch: watch })
    }
}
