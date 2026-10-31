//! fs.url through `Core::handle`, and `Core::file_url`, which the app's `desk-plugin` scheme asks:
//! a URL needs the read grant, its token is 128 random bits, and it names its file only while the
//! caller runs and still holds a grant that covers the path.

mod support;

use std::fs;
use std::path::PathBuf;

use desk_bridge::{BridgeError, ErrorCode};
use desk_core::Core;
use serde_json::{Value, json};
use support::{call, grant, home, install_hello, plugin_manage, roots, set_enabled};

const HELLO: &str = "example.hello";

fn movies() -> Value {
    json!({ "permission": "fs:read", "paths": ["~/Movies/**"] })
}

/// A core with `example.hello` installed and `~/Movies/Holiday 2026.mp4` (1000 bytes) on disk.
fn core() -> (Core, PathBuf) {
    let home = home("fs-url");
    fs::create_dir_all(home.join("Movies")).unwrap();
    fs::write(home.join("Movies/Holiday 2026.mp4"), vec![7u8; 1000]).unwrap();
    let core = Core::new(roots(&home));
    install_hello(&core, &home);
    (core, home)
}

fn url_of(core: &Core, caller: &str, path: &str) -> Result<Value, BridgeError> {
    call(core, caller, "fs.url", json!({ "path": path, "scope": movies() }))
}

/// The token in `/_desk/file/<token>/<file name>`.
fn token_of(answer: &Value) -> String {
    let url = answer["url"].as_str().unwrap();
    let parts: Vec<&str> = url.split('/').collect();
    assert_eq!(parts[..3], ["", "_desk", "file"], "{url}");
    assert_eq!(parts.len(), 5, "{url}");
    parts[3].to_owned()
}

fn resolves(core: &Core, token: &str) -> Option<PathBuf> {
    core.file_url(token).map(|file| file.path)
}

#[test]
fn fs_url_needs_the_read_grant() {
    let (core, home) = core();
    let denied = url_of(&core, HELLO, "~/Movies/Holiday 2026.mp4").unwrap_err();
    assert_eq!(denied.code, ErrorCode::PermissionDenied);
    assert_eq!(denied.permission, Some(serde_json::from_value(movies()).unwrap()));

    grant(&core, HELLO, movies());
    let answer = url_of(&core, HELLO, "~/Movies/Holiday 2026.mp4").unwrap();
    assert_eq!(answer["size"], json!(1000));
    assert_eq!(answer["type"], json!("video/mp4"));
    let url = answer["url"].as_str().unwrap();
    assert!(url.ends_with("/Holiday%202026.mp4"), "{url}");
    let file = core.file_url(&token_of(&answer)).unwrap();
    assert_eq!(file.path, home.join("Movies/Holiday 2026.mp4"));
    assert_eq!(file.media_type, "video/mp4");

    // The scope must cover the path, and the file must be one.
    let outside = call(
        &core,
        HELLO,
        "fs.url",
        json!({ "path": "~/Documents/hello.md", "scope": movies() }),
    );
    assert_eq!(outside.unwrap_err().code, ErrorCode::PermissionDenied);
    let missing = url_of(&core, HELLO, "~/Movies/none.mp4").unwrap_err();
    assert_eq!(missing.code, ErrorCode::NotFound);
    let folder = url_of(&core, HELLO, "~/Movies").unwrap_err();
    assert_eq!(folder.code, ErrorCode::InvalidParams);
}

#[test]
fn a_token_resolves_to_its_file_until_the_caller_unloads() {
    let (core, home) = core();
    grant(&core, HELLO, movies());
    grant(&core, "desk", plugin_manage());
    let answer = url_of(&core, HELLO, "~/Movies/Holiday 2026.mp4").unwrap();
    let token = token_of(&answer);
    let film = home.join("Movies/Holiday 2026.mp4");
    assert_eq!(resolves(&core, &token), Some(film.clone()));
    assert_eq!(resolves(&core, &token), Some(film), "every request, not once");

    set_enabled(&core, HELLO, false);
    assert_eq!(resolves(&core, &token), None, "the caller unloaded");
    set_enabled(&core, HELLO, true);
    assert_eq!(resolves(&core, &token), None, "a URL does not come back");
    assert_eq!(resolves(&core, "0123456789abcdef0123456789abcdef"), None);
    assert_eq!(resolves(&core, ""), None);
}

#[test]
fn a_revoked_grant_stops_the_url() {
    let (core, home) = core();
    let path = home.join("Movies/Holiday 2026.mp4");
    let wide = grant(&core, HELLO, movies());
    let token = token_of(&url_of(&core, HELLO, "~/Movies/Holiday 2026.mp4").unwrap());
    // Another grant that covers the path keeps the URL working; the last one going stops it.
    let film = json!({ "permission": "fs:read", "paths": ["~/Movies/Holiday 2026.mp4"] });
    let narrow = grant(&core, HELLO, film);
    call(&core, HELLO, "perm.revoke", json!({ "grantId": wide })).unwrap();
    assert_eq!(resolves(&core, &token), Some(path.clone()), "the narrow grant covers it");
    call(&core, HELLO, "perm.revoke", json!({ "grantId": narrow })).unwrap();
    assert_eq!(resolves(&core, &token), None, "no grant covers the path");

    // A grant given back later does not revive the token.
    grant(&core, HELLO, movies());
    assert_eq!(resolves(&core, &token), None);
    let again = token_of(&url_of(&core, HELLO, "~/Movies/Holiday 2026.mp4").unwrap());
    assert_eq!(resolves(&core, &again), Some(path));
}

#[test]
fn a_once_grant_is_spent_by_the_call_that_makes_the_url() {
    let (core, _home) = core();
    let once = json!({
        "permission": movies(), "reason": "play a film", "duration": "once",
    });
    let core = core.with_prompter(support::SayYes);
    call(&core, HELLO, "perm.request", once).unwrap();
    let answer = url_of(&core, HELLO, "~/Movies/Holiday 2026.mp4").unwrap();
    assert_eq!(resolves(&core, &token_of(&answer)), None);
    grant(&core, HELLO, movies());
    assert_eq!(resolves(&core, &token_of(&answer)), None, "and it stays spent");
}

#[test]
fn tokens_are_distinct_and_128_bits() {
    let (core, _home) = core();
    grant(&core, HELLO, movies());
    let first = token_of(&url_of(&core, HELLO, "~/Movies/Holiday 2026.mp4").unwrap());
    let second = token_of(&url_of(&core, HELLO, "~/Movies/Holiday 2026.mp4").unwrap());
    assert_ne!(first, second);
    for token in [&first, &second] {
        assert_eq!(token.len(), 32, "{token}");
        assert!(
            token.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')),
            "{token}"
        );
    }
    assert!(core.file_url(&first).is_some() && core.file_url(&second).is_some());
}
