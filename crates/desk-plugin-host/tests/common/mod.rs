//! A mock `Host` that records every call (`mock`), plugin folders in temporary directories, and
//! small test components written in component WAT (`wat`).
#![allow(dead_code)]

mod mock;
mod wat;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use desk_plugin_host::{Limits, LogicHost};
use serde_json::{Value, json};

// Each test binary uses some of these, so most binaries leave some unused.
#[allow(unused_imports)]
pub use mock::{Answer, Call, Line, MockHost, Note, level_name};
#[allow(unused_imports)]
pub use wat::{Exports, component, exports, failing, fine, on_command, on_event};

/// examples/plugin-hello-wasm, with its committed component.
pub fn hello_wasm() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/plugin-hello-wasm")
}

/// examples/plugin-hello-wasm installed and started, on a mock that holds its hello.txt.
pub fn hello_wasm_started() -> (Arc<MockHost>, LogicHost) {
    let host = MockHost::with_file("${plugin}/hello.txt", b"Hi");
    let mut logic = LogicHost::new(Arc::clone(&host) as _, Limits::default()).unwrap();
    let id = logic.install(&hello_wasm()).unwrap();
    logic.start(&id).unwrap();
    (host, logic)
}

/// A plugin folder in a temporary directory, removed when dropped.
pub struct PluginDir {
    pub path: PathBuf,
}

impl PluginDir {
    /// A logic plugin `id` whose entry `plugin.wasm` holds `bytes`.
    pub fn logic(id: &str, permissions: Value, bytes: &[u8]) -> Self {
        let dir = Self::manifest(json!({
            "id": id,
            "version": "0.1.0",
            "kind": "logic",
            "entry": "plugin.wasm",
            "permissions": permissions,
        }));
        dir.write("plugin.wasm", bytes);
        dir
    }

    /// A folder with only this plugin.json.
    pub fn manifest(manifest: Value) -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("desk-plugin-host-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("plugin.json"), manifest.to_string()).unwrap();
        Self { path }
    }

    pub fn write(&self, name: &str, bytes: &[u8]) {
        fs::write(self.path.join(name), bytes).unwrap();
    }
}

impl Drop for PluginDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}
