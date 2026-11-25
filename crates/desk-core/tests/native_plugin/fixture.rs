//! The socket-speaking native plugin for the integration tests. A POSIX shell execs this same
//! test binary so the protocol works even with descriptors that dash cannot redirect.

use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::os::fd::{FromRawFd, RawFd};
use std::os::unix::net::UnixStream;

use desk_surface::env::{BRIDGE_FD, PLUGIN_ID, SURFACE_FD};
use serde_json::json;

const EXECUTABLE: &str = "DESK_TEST_NATIVE_EXECUTABLE";
const CASE: &str = "DESK_TEST_NATIVE_CASE";
const ARGUMENT: &str = "DESK_TEST_NATIVE_ARGUMENT";

pub(super) const RUN: &str = r#"DESK_TEST_NATIVE_ARGUMENT="$1" exec "$DESK_TEST_NATIVE_EXECUTABLE" --exact native_fixture::serve --ignored --quiet"#;

pub(super) fn environment(tag: &str) -> [(String, String); 2] {
    [
        (
            EXECUTABLE.to_owned(),
            std::env::current_exe().unwrap().display().to_string(),
        ),
        (CASE.to_owned(), tag.to_owned()),
    ]
}

#[allow(unsafe_code)]
fn connection(variable: &str) -> BufReader<UnixStream> {
    let fd: RawFd = std::env::var(variable).unwrap().parse().unwrap();
    assert!(fd > 9, "the fixture must exercise a high descriptor");
    // SAFETY: NativeProcess passes an open Unix socket and transfers ownership to the child.
    // Each fixture calls this once for the descriptor it uses.
    let stream = unsafe {
        assert!(libc::fcntl(fd, libc::F_GETFD) >= 0, "descriptor is open");
        UnixStream::from_raw_fd(fd)
    };
    BufReader::new(stream)
}

fn bridge() {
    let mut peer = connection(BRIDGE_FD);
    let mut out = File::create("out").unwrap();
    let calls = [
        json!({"id": 1, "method": "settings.get", "params": {"key": "speed"}}),
        json!({"id": 2, "method": "socket.agent", "params": {"agent": "codex"}}),
        json!({"id": 3, "method": "fs.read", "params": {
            "path": "~/x", "scope": {"permission": "fs:read", "paths": ["~/**"]}
        }}),
    ];
    let mut reply = String::new();
    for call in calls {
        writeln!(peer.get_mut(), "{call}").unwrap();
        reply.clear();
        assert_ne!(peer.read_line(&mut reply).unwrap(), 0);
        out.write_all(reply.as_bytes()).unwrap();
    }
    let id = std::env::var(PLUGIN_ID).unwrap();
    let argument = std::env::var(ARGUMENT).unwrap();
    fs::write("env", format!("{id} {argument}\n")).unwrap();
}

fn surface() {
    let mut peer = connection(SURFACE_FD);
    let mut input = String::new();
    assert_ne!(peer.read_line(&mut input).unwrap(), 0);
    fs::write("got", input).unwrap();
    let ready = json!({"type": "ready", "surface": "main.example-native--test"});
    writeln!(peer.get_mut(), "{ready}").unwrap();
}

fn stops() {
    let mut peer = connection(SURFACE_FD);
    fs::write("started", "").unwrap();
    assert_eq!(peer.read_line(&mut String::new()).unwrap(), 0);
}

#[test]
#[ignore = "spawned by the native plugin integration tests"]
fn serve() {
    let Ok(case) = std::env::var(CASE) else {
        return;
    };
    match case.as_str() {
        "bridge" => bridge(),
        "surface" => surface(),
        "stops" => stops(),
        _ => panic!("unknown native plugin fixture: {case}"),
    }
}
