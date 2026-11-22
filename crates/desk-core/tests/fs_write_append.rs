//! fs.write with `append` (ADR 0356): the content goes at the end of the existing file in place, so
//! a file is written in chunks without being held whole; it keeps no version and needs the same
//! fs:write scope, and a missing file is not_found.

mod history_support;

use std::fs;

use desk_bridge::ErrorCode;
use history_support::*;
use serde_json::json;

fn append(
    core: &desk_core::Core,
    path: &str,
    content: &str,
) -> Result<serde_json::Value, ErrorCode> {
    let scope = json!({ "permission": "fs:write", "paths": ["~/notes/**"] });
    let params = json!({ "path": path, "content": content, "append": true, "scope": scope });
    call(core, NOTES, "fs.write", params)
}

#[test]
fn fs_write_appends_in_place() {
    let home = home();
    let core = core(&home);
    let first = write(&core, "~/notes/rows.tsv", "1\tone\n");
    assert_eq!(first["bytesWritten"], 6);
    assert_eq!(
        append(&core, "~/notes/rows.tsv", "2\ttwo\n"),
        Ok(json!({ "bytesWritten": 6 }))
    );
    let scope = json!({ "permission": "fs:write", "paths": ["~/notes/**"] });
    let binary = json!({ "path": "~/notes/rows.tsv", "content": "Mwl0aHJlZQo=",
        "encoding": "base64", "append": true, "scope": scope });
    assert_eq!(
        call(&core, NOTES, "fs.write", binary),
        Ok(json!({ "bytesWritten": 8 }))
    );
    assert_eq!(
        fs::read_to_string(home.join("notes/rows.tsv")).unwrap(),
        "1\tone\n2\ttwo\n3\tthree\n"
    );
    // An append replaces nothing, so nothing is kept.
    assert!(
        history(&core, NOTES, "~/notes/rows.tsv", None)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        append(&core, "~/notes/missing.tsv", "x"),
        Err(ErrorCode::NotFound)
    );
    assert!(!home.join("notes/missing.tsv").exists());
    let outside = json!({ "path": "~/other.tsv", "content": "x", "append": true,
        "scope": { "permission": "fs:write", "paths": ["~/other.tsv"] } });
    assert_eq!(
        call(&core, NOTES, "fs.write", outside),
        Err(ErrorCode::PermissionDenied)
    );
}
