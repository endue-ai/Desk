//! The runtime's writes in the desk folder against the real core with the runtime's own grants
//! (#102, ADR 0079): `packages/runtime/src/policies/desk-folder.ts` names the folder a profile goes
//! in, which the core's `createDirs` rule asks for (core_fs.rs), and writes keys.yaml without making
//! a folder. Another caller (the CLI over desk.sock, an agent) holds no such grant: it saves a
//! profile by running desk.profiles.save, and the runtime writes as itself.

use std::fs;
use std::path::PathBuf;

use desk_boot::grants::{RUNTIME_CALLER, grant_runtime};
use desk_bridge::{BridgeRequest, BridgeResponse, ErrorCode};
use desk_core::{Core, Roots};
use serde_json::{Value, json};

const PROFILE: &str = "~/.desk/profiles/quiet.yaml";
const KEYS: &str = "~/.desk/keys.yaml";

/// A fresh home and data folder, the core over them and the runtime's grants.
fn desk(tag: &str) -> (Core, PathBuf) {
    let root = std::env::temp_dir().join(format!("desk-boot-folder-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    let (home, data) = (root.join("home"), root.join("data"));
    fs::create_dir_all(&home).unwrap();
    fs::create_dir_all(&data).unwrap();
    let core = Core::new(Roots { home: home.clone() });
    grant_runtime(&core, &data, &home);
    (core, home)
}

fn write(
    core: &Core,
    caller: &str,
    path: &str,
    paths: &[&str],
    create: bool,
) -> Result<Value, (ErrorCode, String)> {
    let mut params = json!({ "path": path, "content": "name: Quiet\n", "encoding": "utf8",
        "scope": { "permission": "fs:write", "paths": paths } });
    if create {
        params["createDirs"] = json!(true);
    }
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 1, "method": "fs.write", "params": params })).unwrap();
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
        BridgeResponse::BridgeFailure(err) => Err((err.error.code, err.error.message)),
    }
}

#[test]
fn a_profile_whose_scope_names_its_folder_is_written_on_a_fresh_desk() {
    let (core, home) = desk("profile");
    let scope = [PROFILE, "~/.desk/profiles"];
    assert_eq!(
        write(&core, RUNTIME_CALLER, PROFILE, &scope, true),
        Ok(json!({ "bytesWritten": 12 }))
    );
    assert_eq!(
        fs::read_to_string(home.join(".desk/profiles/quiet.yaml")).unwrap(),
        "name: Quiet\n"
    );
}

#[test]
fn a_scope_of_the_file_alone_cannot_make_its_folder() {
    // What desk-folder.ts asked before #102: refused for every caller of desk.profiles.save.
    let (core, home) = desk("old");
    fs::create_dir_all(home.join(".desk/profiles")).unwrap();
    let (code, message) = write(&core, RUNTIME_CALLER, PROFILE, &[PROFILE], true).unwrap_err();
    assert_eq!(code, ErrorCode::PermissionDenied);
    assert!(message.contains("the scope does not cover"), "{message}");
    assert!(message.contains("~/.desk/profiles"), "{message}");
    let (code, _) = write(&core, RUNTIME_CALLER, KEYS, &[KEYS], true).unwrap_err();
    assert_eq!(
        code,
        ErrorCode::PermissionDenied,
        "keys.yaml's folder is not the runtime's"
    );
}

#[test]
fn keys_yaml_is_written_into_the_desk_folder_without_making_one() {
    let (core, home) = desk("keys");
    fs::create_dir_all(home.join(".desk")).unwrap();
    assert!(write(&core, RUNTIME_CALLER, KEYS, &[KEYS], false).is_ok());
    assert!(home.join(".desk/keys.yaml").exists());
}

#[test]
fn another_caller_holds_no_grant_on_the_desk_folder() {
    let (core, home) = desk("cli");
    let scope = [PROFILE, "~/.desk/profiles"];
    let (code, message) = write(&core, "cli", PROFILE, &scope, true).unwrap_err();
    assert_eq!(code, ErrorCode::PermissionDenied);
    assert!(message.contains("no grant covers the scope"), "{message}");
    assert!(!home.join(".desk/profiles/quiet.yaml").exists());
}
