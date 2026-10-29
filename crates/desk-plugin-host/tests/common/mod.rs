//! A mock `Host` that records every call, plugin folders in temporary directories, and small test
//! components written in component WAT.
#![allow(dead_code)]

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use desk_plugin_host::{DirEntry, EntryKind, Error, ErrorCode, Grant, Host, NotifyLevel};
use desk_plugin_host::{Request, Response};
use serde_json::{Value, json};

/// One call that reached the host: the plugin, the bridge method and its main argument.
pub type Call = (String, String, String);

#[derive(Default)]
pub struct MockHost {
    files: Mutex<BTreeMap<String, Vec<u8>>>,
    refused: Mutex<BTreeSet<String>>,
    calls: Mutex<Vec<Call>>,
    notes: Mutex<Vec<(String, String, Option<String>, NotifyLevel)>>,
    store: Mutex<BTreeMap<(String, String), Value>>,
}

impl MockHost {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn with_file(path: &str, content: &[u8]) -> Arc<Self> {
        let host = Self::default();
        host.files
            .lock()
            .unwrap()
            .insert(path.into(), content.into());
        Arc::new(host)
    }

    /// Answer `method` (for example "fs.read") with permission-denied from now on.
    pub fn refuse(&self, method: &str) {
        self.refused.lock().unwrap().insert(method.into());
    }

    pub fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }

    pub fn notes(&self) -> Vec<(String, String, Option<String>, NotifyLevel)> {
        self.notes.lock().unwrap().clone()
    }

    pub fn stored(&self, plugin: &str, key: &str) -> Option<Value> {
        let store = self.store.lock().unwrap();
        store.get(&(plugin.to_owned(), key.to_owned())).cloned()
    }

    fn call(&self, plugin: &str, method: &str, arg: &str) -> Result<(), Error> {
        let call = (plugin.to_owned(), method.to_owned(), arg.to_owned());
        self.calls.lock().unwrap().push(call);
        if self.refused.lock().unwrap().contains(method) {
            return Err(Error {
                code: ErrorCode::PermissionDenied,
                message: format!("{method} is not granted"),
            });
        }
        Ok(())
    }
}

impl Host for MockHost {
    fn fs_read(&self, plugin: &str, path: &str) -> Result<Vec<u8>, Error> {
        self.call(plugin, "fs.read", path)?;
        self.files.lock().unwrap().get(path).cloned().ok_or(Error {
            code: ErrorCode::NotFound,
            message: format!("{path} does not exist"),
        })
    }

    fn fs_list(&self, plugin: &str, path: &str) -> Result<Vec<DirEntry>, Error> {
        self.call(plugin, "fs.list", path)?;
        Ok(vec![DirEntry {
            name: "hello.txt".into(),
            kind: EntryKind::File,
            size: Some(5),
        }])
    }

    fn fs_write(
        &self,
        plugin: &str,
        path: &str,
        contents: &[u8],
        create_dirs: bool,
    ) -> Result<u64, Error> {
        self.call(
            plugin,
            "fs.write",
            &format!("{path} create_dirs={create_dirs}"),
        )?;
        self.files
            .lock()
            .unwrap()
            .insert(path.into(), contents.into());
        Ok(contents.len() as u64)
    }

    fn net_fetch(&self, plugin: &str, request: Request) -> Result<Response, Error> {
        self.call(
            plugin,
            "net.fetch",
            &format!("{} {}", request.method, request.url),
        )?;
        Ok(Response {
            status: 200,
            headers: vec![("content-type".into(), "text/plain".into())],
            body: b"ok".to_vec(),
        })
    }

    fn ui_notify(
        &self,
        plugin: &str,
        title: &str,
        body: Option<&str>,
        level: NotifyLevel,
    ) -> Result<(), Error> {
        self.call(plugin, "ui.notify", title)?;
        let note = (plugin.into(), title.into(), body.map(str::to_owned), level);
        self.notes.lock().unwrap().push(note);
        Ok(())
    }

    fn perm_query(&self, plugin: &str) -> Vec<Grant> {
        let _ = self.call(plugin, "perm.query", "");
        vec![Grant {
            grant_id: "g1".into(),
            permission: json!({ "permission": "ui:notify" }).to_string(),
        }]
    }

    fn store_get(&self, plugin: &str, key: &str) -> Result<Option<Value>, Error> {
        self.call(plugin, "store.get", key)?;
        Ok(self.stored(plugin, key))
    }

    fn store_set(&self, plugin: &str, key: &str, value: Value) -> Result<(), Error> {
        self.call(plugin, "store.set", key)?;
        let mut store = self.store.lock().unwrap();
        store.insert((plugin.to_owned(), key.to_owned()), value);
        Ok(())
    }
}

/// examples/plugin-hello-wasm, with its committed component.
pub fn hello_wasm() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples/plugin-hello-wasm")
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

/// A component exporting `start` whose core function runs `body` and then returns the result stored
/// at offset 1024 of its memory, which `data` (WAT string escapes) fills; zeroes there mean `ok`.
pub fn component(body: &str, data: &str) -> Vec<u8> {
    let wat = format!(
        r#"(component
  (core module $m
    (memory (export "memory") 1)
    (data (i32.const 1024) "{data}")
    (func (export "start") (result i32) {body} (i32.const 1024)))
  (core instance $i (instantiate $m))
  (type $code (enum "permission-denied" "invalid-params" "not-found" "already-exists" "io-error"
    "timeout" "cancelled" "unsupported" "internal"))
  (export $code-out "error-code" (type $code))
  (type $error (record (field "code" $code-out) (field "message" string)))
  (export $error-out "error" (type $error))
  (func $start (result (result (error $error-out)))
    (canon lift (core func $i "start") (memory $i "memory")))
  (export "start" (func $start)))"#
    );
    wat::parse_str(wat).expect("the test component is valid WAT")
}

/// `start` succeeds.
pub fn fine() -> Vec<u8> {
    component("", "")
}

/// `start` returns the guest error `internal` with `message` (at most 16 ASCII bytes).
pub fn failing(message: &str) -> Vec<u8> {
    assert!(message.len() <= 16 && message.is_ascii());
    // result tag 1 at 1024, enum case 8 (internal) at 1028, string pointer 1040 and length at 1032.
    let len = message.len();
    component(
        "",
        &format!(r"\01\00\00\00\08\00\00\00\10\04\00\00\{len:02x}\00\00\00{message}"),
    )
}
