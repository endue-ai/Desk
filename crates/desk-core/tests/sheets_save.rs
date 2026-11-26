//! A built-in save has to authenticate the invocation before it can write its named file.

mod support;

use std::fs;

use desk_bridge::ErrorCode;
use desk_core::Core;
use serde_json::{Value, json};
use support::{call, grant, home, roots};

const SHEETS: &str = "endue.sheets";
const FILE: &str = "~/Documents/fixture.csv";
const ORIGINAL: &str = "Name,Count\nExample,1\n";
const UPDATED: &str = "Name,Count\nExample,2\n";

fn scope() -> Value {
    json!({ "permission": "fs:write", "paths": [FILE] })
}

fn write(invocation: &str) -> Value {
    json!({ "path": FILE, "content": UPDATED, "scope": scope(), "invocationId": invocation })
}

#[test]
fn a_fabricated_save_invocation_cannot_fall_back_to_a_plugin_grant() {
    let root = home("sheets-forged-save");
    let path = root.join("Documents/fixture.csv");
    fs::write(&path, ORIGINAL).unwrap();
    let core = Core::new(roots(&root));
    grant(&core, SHEETS, scope());
    let denied = call(&core, SHEETS, "fs.write", write("i-forged")).unwrap_err();
    assert_eq!(denied.code, ErrorCode::InvalidParams);
    assert_eq!(fs::read_to_string(path).unwrap(), ORIGINAL);
    fs::remove_dir_all(root).unwrap();
}
