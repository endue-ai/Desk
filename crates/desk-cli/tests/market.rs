//! `desk market list` and `desk market install <id> [--accept]` through the desk socket (ADR 0107):
//! one line per entry, and an install that names the permissions it asks until they are accepted.
#![cfg(unix)]

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::process::{Command, Output};
use std::sync::{Arc, Mutex};

use desk_bridge::{BridgeRequest, Permission};
use desk_core::{Core, Roots};
use desk_ipc::{CALLER, Listener};
use desk_update::verify::sha256_hex;
use serde_json::{Value, json};

const ACME: &str = "https://market.acme.test/index.json";
const BOARD: &str = "https://market.acme.test/board.desk-plugin";

fn desk(socket: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_desk"))
        .args(args)
        .env("DESK_SOCKET", socket)
        .output()
        .expect("desk runs")
}

fn board() -> Vec<u8> {
    let manifest = json!({
        "id": "acme.board", "name": "Board", "version": "1.0.0", "kind": "view",
        "permissions": [{ "permission": "data:read", "kinds": ["task"] }],
        "view": {
            "id": "acme.board", "version": "1.0.0", "title": "Board",
            "requires": { "tasks": { "kinds": ["task"] } },
            "layout": { "type": "list", "binding": { "kinds": ["task"], "sources": ["$tasks"] } }
        }
    });
    let bundle = json!({ "format": "desk-plugin/1", "manifest": manifest, "files": {} });
    serde_json::to_vec(&bundle).unwrap()
}

#[test]
fn market_list_and_install_through_the_socket() {
    let home = std::env::temp_dir().join(format!("dcli-market-{}", std::process::id()));
    let _ = fs::remove_dir_all(&home);
    fs::create_dir_all(&home).unwrap();
    let bytes = board();
    let entry = json!({
        "id": "acme.board", "kind": "view", "name": "Board", "version": "1.0.0", "publisher": "Acme",
        "license": "CC0-1.0", "url": BOARD, "sha256": sha256_hex(&bytes), "size": bytes.len(),
        "permissions": [{ "permission": "data:read", "kinds": ["task"] }]
    });
    let index = json!({ "format": "desk-market-index/1", "entries": [entry] });
    let pages: BTreeMap<String, Vec<u8>> = [
        (ACME.to_owned(), serde_json::to_vec(&index).unwrap()),
        (BOARD.to_owned(), bytes),
    ]
    .into();
    let pages = Arc::new(Mutex::new(pages));
    let core = Core::new(Roots { home: home.clone() })
        .with_market_dir(home.join("data/plugins"))
        .with_theme_fetch(Box::new(move |url: &str| {
            let page = pages.lock().unwrap().get(url).cloned();
            page.ok_or_else(|| format!("{url} answered 404"))
        }));
    let core = Arc::new(core);
    for permission in desk_ipc::grants() {
        core.grant(CALLER, permission);
    }
    let manage: Permission =
        serde_json::from_value(json!({ "permission": "plugin:manage" })).unwrap();
    core.grant("desk", manage);
    for (key, value) in [
        ("market.indexes", json!([ACME])),
        ("theme.markets", json!([])),
        ("design.markets", json!([])),
    ] {
        let request: BridgeRequest = serde_json::from_value(json!({
            "id": 1, "method": "settings.set", "params": { "key": key, "value": value }
        }))
        .unwrap();
        core.handle("desk", request);
    }
    let socket = home.join("desk.sock");
    let _listener = Listener::bind(&socket, Arc::clone(&core)).expect("bind the desk socket");

    let out = desk(&socket, &["market", "list"]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        format!("view\tacme.board\t1.0.0\tavailable\tnot-verified\t{ACME}\n")
    );

    let out = desk(&socket, &["market", "install", "acme.board"]);
    assert_eq!(out.status.code(), Some(1), "it asks first");
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    assert!(
        stdout.contains("asks\tdata:read\t{\"kinds\":[\"task\"]}"),
        "{stdout}"
    );
    assert!(stdout.contains("--accept"), "{stdout}");
    assert!(core.plugins().iter().all(|p| p.id != "acme.board"));

    let out = desk(&socket, &["market", "install", "acme.board", "--accept"]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        "installed\tacme.board\t1.0.0\n"
    );
    let installed = core.plugins().into_iter().find(|p| p.id == "acme.board");
    assert_eq!(
        installed
            .and_then(|p| p.manifest)
            .map(|m| m.version)
            .as_deref(),
        Some("1.0.0")
    );
    let listed: Value =
        serde_json::from_slice(&desk(&socket, &["--json", "market", "list"]).stdout).unwrap();
    assert_eq!(listed["entries"][0]["state"], "installed");
}
