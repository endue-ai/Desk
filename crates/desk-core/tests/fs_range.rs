//! fs.read of a byte range through `Core::handle`: `offset` and `length` pick the bytes, the result
//! carries the file's total `size`, a range past the end returns what is there, `length: 0` only
//! the size, and the read grant is checked as for a whole file.

mod support;

use std::fs;
use std::path::Path;

use desk_bridge::{BridgeError, ErrorCode};
use desk_core::Core;
use serde_json::{Value, json};
use support::{NOTES, call, grant, home, roots};

/// A core whose home holds `~/Documents/blob.bin`: 100 bytes, `3 * i` for byte `i`, not UTF-8.
fn core_with_blob() -> (Core, std::path::PathBuf) {
    let home = home("fs-range");
    let bytes: Vec<u8> = (0u8..100).map(|b| b.wrapping_mul(3)).collect();
    fs::write(home.join("Documents/blob.bin"), bytes).unwrap();
    (Core::new(roots(&home)), home)
}

fn docs() -> Value {
    json!({ "permission": "fs:read", "paths": ["~/Documents/**"] })
}

fn read(core: &Core, path: &str, extra: Value) -> Result<Value, BridgeError> {
    let mut params = json!({ "path": path, "scope": docs() });
    params
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().cloned().unwrap_or_default());
    call(core, NOTES, "fs.read", params)
}

fn base64(bytes: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn blob(home: &Path) -> Vec<u8> {
    fs::read(home.join("Documents/blob.bin")).unwrap()
}

#[test]
fn reads_a_byte_range_and_reports_the_size() {
    let (core, home) = core_with_blob();
    grant(&core, NOTES, docs());
    let range = json!({ "encoding": "base64", "offset": 10, "length": 5 });
    let answer = read(&core, "~/Documents/blob.bin", range).unwrap();
    assert_eq!(
        answer,
        json!({ "content": base64(&blob(&home)[10..15]), "encoding": "base64", "size": 100 })
    );
    // A whole file reports its size too, and a range of UTF-8 text reads as text.
    let whole = read(&core, "~/Documents/hello.md", json!({})).unwrap();
    assert_eq!(
        whole,
        json!({ "content": "# Hello", "encoding": "utf8", "size": 7 })
    );
    let text = read(&core, "~/Documents/hello.md", json!({ "offset": 2 })).unwrap();
    assert_eq!(
        text,
        json!({ "content": "Hello", "encoding": "utf8", "size": 7 })
    );
}

#[test]
fn a_range_past_the_end_returns_what_is_there() {
    let (core, home) = core_with_blob();
    grant(&core, NOTES, docs());
    let tail = json!({ "encoding": "base64", "offset": 95, "length": 50 });
    let answer = read(&core, "~/Documents/blob.bin", tail).unwrap();
    assert_eq!(answer["content"], json!(base64(&blob(&home)[95..])));
    assert_eq!(answer["size"], json!(100));
    for offset in [100u64, 1 << 40] {
        let beyond = json!({ "encoding": "base64", "offset": offset, "length": 8 });
        let answer = read(&core, "~/Documents/blob.bin", beyond).unwrap();
        assert_eq!(
            answer,
            json!({ "content": "", "encoding": "base64", "size": 100 }),
            "from {offset}"
        );
    }
    // A range of bytes that are not UTF-8 is read as base64, as a whole file is.
    let asked_as_text = read(&core, "~/Documents/blob.bin", json!({ "offset": 50 }));
    assert_eq!(asked_as_text.unwrap_err().code, ErrorCode::InvalidParams);
}

#[test]
fn length_zero_returns_only_the_size() {
    let (core, _home) = core_with_blob();
    grant(&core, NOTES, docs());
    for encoding in ["base64", "utf8"] {
        let none = json!({ "encoding": encoding, "offset": 40, "length": 0 });
        let answer = read(&core, "~/Documents/blob.bin", none).unwrap();
        assert_eq!(
            answer,
            json!({ "content": "", "encoding": encoding, "size": 100 })
        );
    }
    let missing = read(&core, "~/Documents/none.bin", json!({ "length": 0 }));
    assert_eq!(missing.unwrap_err().code, ErrorCode::NotFound);
    let folder = read(&core, "~/Documents", json!({ "length": 0 }));
    assert_eq!(folder.unwrap_err().code, ErrorCode::InvalidParams);
}

#[test]
fn a_range_needs_the_read_grant() {
    let (core, _home) = core_with_blob();
    let range = json!({ "encoding": "base64", "offset": 10, "length": 5 });
    let denied = read(&core, "~/Documents/blob.bin", range.clone()).unwrap_err();
    assert_eq!(denied.code, ErrorCode::PermissionDenied);
    assert_eq!(
        denied.permission,
        Some(serde_json::from_value(docs()).unwrap())
    );
    grant(
        &core,
        NOTES,
        json!({ "permission": "fs:read", "paths": ["~/Calendar/**"] }),
    );
    let other = read(&core, "~/Documents/blob.bin", range).unwrap_err();
    assert_eq!(other.code, ErrorCode::PermissionDenied, "a grant elsewhere");
}
