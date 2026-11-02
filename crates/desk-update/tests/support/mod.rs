//! A release origin in memory, signed with a key made for the test run, and an installer that
//! records what it was handed. Nothing key-like is committed: every key is generated here.
#![allow(dead_code)]

use std::collections::BTreeMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use desk_update::verify::sha256_hex;
use desk_update::{Chosen, Config, Installer, Transport};
use serde_json::{Value, json};

pub const BASE: &str = "https://releases.example.test/desk";
pub const LINUX: &str = "linux-x86_64";
pub const DEB: &str = "linux-x86_64-deb";
pub const MAC: &str = "darwin-aarch64";

fn b64(text: String) -> String {
    base64::engine::general_purpose::STANDARD.encode(text)
}

/// A minisign key pair in the Tauri encoding.
pub struct Key(minisign::KeyPair);

impl Key {
    pub fn new() -> Self {
        Self(minisign::KeyPair::generate_unencrypted_keypair().unwrap())
    }

    /// The public key as the app embeds it.
    pub fn public(&self) -> String {
        b64(self.0.pk.to_box().unwrap().into_string())
    }

    /// A signature as the Tauri CLI writes it; with `version`, its trusted comment names it.
    pub fn sign(&self, data: &[u8], version: Option<&str>) -> String {
        let mut comment = "timestamp:1700000000\tfile:artifact".to_owned();
        if let Some(version) = version {
            comment.push_str(&format!("\tversion:{version}"));
        }
        let signature = minisign::sign(
            Some(&self.0.pk),
            &self.0.sk,
            Cursor::new(data),
            Some(&comment),
            Some("signature from tauri secret key"),
        )
        .unwrap();
        b64(signature.into_string())
    }
}

/// A fresh folder for one test.
pub fn dir(tag: &str) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("desk-update-{tag}-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

/// Bytes that stand in for one build's artifact.
pub fn artifact(version: &str, target: &str) -> Vec<u8> {
    format!("endue Desk {version} for {target}\n")
        .repeat(400)
        .into_bytes()
}

/// The release origin: documents by URL, and what was downloaded.
#[derive(Default)]
pub struct Origin {
    files: Mutex<BTreeMap<String, Vec<u8>>>,
    pub downloads: Mutex<Vec<String>>,
}

impl Origin {
    pub fn put(&self, url: &str, bytes: Vec<u8>) {
        self.files.lock().unwrap().insert(url.to_owned(), bytes);
    }

    pub fn remove(&self, url: &str) {
        self.files.lock().unwrap().remove(url);
    }

    /// Publish `version` with an artifact per target, signed by `key`; answers its index entry.
    pub fn release(&self, key: &Key, version: &str, targets: &[&str], min_from: &str) -> Value {
        let mut platforms = serde_json::Map::new();
        let mut artifacts = serde_json::Map::new();
        for target in targets {
            let bytes = artifact(version, target);
            let url = format!("{BASE}/releases/{version}/endue-desk_{version}_{target}.bin");
            let signature = key.sign(&bytes, Some(version));
            platforms.insert(
                target.to_string(),
                json!({ "url": url, "signature": signature }),
            );
            let digest = sha256_hex(&bytes);
            artifacts.insert(
                target.to_string(),
                json!({ "sha256": digest, "size": bytes.len() }),
            );
            self.put(&url, bytes);
        }
        let manifest = json!({
            "version": version,
            "notes": format!("https://github.com/endue-ai/Desk/releases/tag/v{version}"),
            "pub_date": "2026-11-20T09:12:00Z",
            "platforms": platforms,
            "desk": { "commit": "c46d12b", "minFrom": min_from, "artifacts": artifacts }
        });
        self.signed(&format!("releases/{version}/release.json"), key, &manifest);
        json!({
            "version": version, "commit": "c46d12b", "date": "2026-11-20", "minFrom": min_from,
            "rollout": 100, "targets": targets, "release": format!("releases/{version}/release.json")
        })
    }

    /// Publish a channel index listing `releases`, signed by `key`.
    pub fn index(&self, key: &Key, channel: &str, serial: u64, releases: Vec<Value>) {
        let index = json!({
            "channel": channel, "serial": serial, "generated": "2026-11-20T09:15:00Z",
            "releases": releases
        });
        self.signed(&format!("channels/{channel}/index.json"), key, &index);
    }

    fn signed(&self, path: &str, key: &Key, document: &Value) {
        let bytes = serde_json::to_vec_pretty(document).unwrap();
        let url = format!("{BASE}/{path}");
        self.put(&format!("{url}.sig"), key.sign(&bytes, None).into_bytes());
        self.put(&url, bytes);
    }
}

impl Transport for Origin {
    fn get(&self, url: &str) -> Result<Vec<u8>, String> {
        let files = self.files.lock().unwrap();
        files.get(url).cloned().ok_or_else(|| format!("404 {url}"))
    }

    fn download(
        &self,
        url: &str,
        progress: &mut dyn FnMut(u64, Option<u64>),
    ) -> Result<Vec<u8>, String> {
        self.downloads.lock().unwrap().push(url.to_owned());
        let bytes = self.get(url)?;
        let total = bytes.len() as u64;
        for chunk in 1..=10 {
            progress(total * chunk / 10, Some(total));
        }
        Ok(bytes)
    }
}

/// An installer that records what it was given, and fails when told to.
#[derive(Default)]
pub struct Recorder {
    pub prepared: Mutex<Vec<String>>,
    pub installed: Mutex<Vec<(String, Vec<u8>)>>,
    pub refuse: Mutex<Option<String>>,
}

impl Installer for Recorder {
    fn prepare(&self, chosen: &Chosen) -> Result<(), String> {
        self.prepared.lock().unwrap().push(chosen.version.clone());
        Ok(())
    }

    fn install(&self, chosen: &Chosen, bytes: &[u8]) -> Result<(), String> {
        if let Some(why) = self.refuse.lock().unwrap().clone() {
            return Err(why);
        }
        let entry = (chosen.version.clone(), bytes.to_vec());
        self.installed.lock().unwrap().push(entry);
        Ok(())
    }
}

/// The running build's configuration: `version` on Linux (deb), checked with `key`.
pub fn config(dir: &Path, key: &Key, version: &str) -> Config {
    Config {
        base: BASE.to_owned(),
        pubkey: key.public(),
        version: version.to_owned(),
        commit: Some("fa7a4af".to_owned()),
        targets: vec![DEB.to_owned(), LINUX.to_owned()],
        dir: dir.to_path_buf(),
    }
}

pub fn shared<T>(value: T) -> Arc<T> {
    Arc::new(value)
}
