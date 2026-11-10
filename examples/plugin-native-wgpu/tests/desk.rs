//! The example against a desk played by this test (macOS): it is started as the desk starts a
//! native plugin (two inherited sockets and the desk's Mach service), reads its setting over the
//! bridge, says hello, draws its scene into an IOSurface whose right reaches the desk with the first
//! frame, answers pings, and keeps its angle and exits when it sleeps.
#![cfg(target_os = "macos")]

use std::io::{BufRead, BufReader, Write};
use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream;
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use desk_surface::env;
use desk_surface::native::mach::{IoSurface, PortService};
use serde_json::{Value, json};

const SURFACE: &str = "main.example-native--wgpu";

struct Desk {
    lines: BufReader<UnixStream>,
    surface: UnixStream,
}

impl Desk {
    fn send(&mut self, message: Value) {
        let mut text = message.to_string();
        text.push('\n');
        self.surface.write_all(text.as_bytes()).unwrap();
    }

    /// The next message of `kind` (`attach`, or a page message's `desk:` type), skipping others.
    fn until(&mut self, kind: &str) -> Value {
        let until = Instant::now() + Duration::from_secs(20);
        loop {
            assert!(Instant::now() < until, "no {kind} came");
            let mut line = String::new();
            assert!(
                self.lines.read_line(&mut line).unwrap() > 0,
                "closed before {kind}"
            );
            let value: Value = serde_json::from_str(&line).unwrap();
            let page = value["message"]["type"].as_str();
            if value["type"] == kind || page == Some(kind) {
                return value;
            }
        }
    }
}

/// The BGRA pixel at (x, y) of `surface`.
#[allow(unsafe_code)]
fn pixel(surface: &IoSurface, x: usize, y: usize) -> [u8; 4] {
    use objc2_io_surface::IOSurfaceLockOptions;
    let mut out = [0; 4];
    // SAFETY: locked for reading, read within its rows, unlocked.
    unsafe {
        surface.lock(IOSurfaceLockOptions::ReadOnly, std::ptr::null_mut());
        let at = surface.base_address().as_ptr().cast::<u8>();
        let at = at.add(y * surface.bytes_per_row() + x * 4);
        std::ptr::copy_nonoverlapping(at, out.as_mut_ptr(), 4);
        surface.unlock(IOSurfaceLockOptions::ReadOnly, std::ptr::null_mut());
    }
    out
}

#[test]
#[allow(unsafe_code)]
fn the_example_draws_into_its_surface_answers_the_desk_and_sleeps_with_its_state() {
    let (surface, surface_child) = UnixStream::pair().unwrap();
    let (bridge, bridge_child) = UnixStream::pair().unwrap();
    let ports = PortService::check_in().unwrap();
    let fds = [surface_child.as_raw_fd(), bridge_child.as_raw_fd()];
    let mut command = Command::new(env!("CARGO_BIN_EXE_plugin-native-wgpu"));
    command
        .stdin(Stdio::null())
        .env(env::PLUGIN_ID, "example.native-wgpu")
        .env(env::SURFACE_FD, fds[0].to_string())
        .env(env::BRIDGE_FD, fds[1].to_string())
        .env(env::MACH_SERVICE, ports.name());
    // SAFETY: only fcntl between fork and exec, on two descriptors the child inherited.
    unsafe {
        command.pre_exec(move || {
            for fd in fds {
                if libc::fcntl(fd, libc::F_SETFD, 0) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
            }
            Ok(())
        });
    }
    let mut child = command.spawn().expect("the example is built");
    drop((surface_child, bridge_child));
    let pid = child.id();

    // Its one bridge call: its own setting.
    let mut calls = BufReader::new(bridge.try_clone().unwrap());
    let mut call = String::new();
    calls.read_line(&mut call).unwrap();
    let call: Value = serde_json::from_str(&call).unwrap();
    assert_eq!(
        (call["method"].as_str(), &call["params"]),
        (Some("settings.get"), &json!({ "key": "speed" }))
    );
    let answer = json!({ "id": call["id"], "ok": true, "result": { "value": 2.0 } });
    (&bridge)
        .write_all(format!("{answer}\n").as_bytes())
        .unwrap();

    let mut desk = Desk {
        lines: BufReader::new(surface.try_clone().unwrap()),
        surface,
    };
    desk.send(
        json!({ "type": "create", "surface": SURFACE, "plugin": "example.native-wgpu",
        "view": "main", "size": { "width": 160, "height": 100 }, "scale": 2, "format": "bgra8" }),
    );
    desk.until("desk:hello");
    let attach = desk.until("attach");
    let texture = &attach["texture"];
    assert_eq!(
        (texture["width"].as_u64(), texture["height"].as_u64()),
        (Some(320), Some(200))
    );
    assert_eq!(
        texture["handle"]["portIndex"], 0,
        "the first frame brings its right"
    );
    let (id, frame) = ports
        .receive(pid, Duration::from_secs(5))
        .expect("its right, from it");
    assert_eq!(u64::from(id), texture["handle"]["id"].as_u64().unwrap());
    let (middle, corner) = (pixel(&frame, 160, 100), pixel(&frame, 2, 2));
    assert_ne!(corner, [0, 0, 0, 0], "the background is drawn");
    assert_ne!(middle, corner, "the triangle is drawn over it");
    desk.until("ready");
    desk.send(json!({ "type": "release", "surface": SURFACE, "frame": attach["frame"] }));
    let next = desk.until("attach");
    assert!(
        next["texture"]["handle"].get("portIndex").is_none(),
        "one right per texture"
    );

    desk.send(json!({ "type": "desk.message", "surface": SURFACE,
        "message": { "type": "desk:init", "pluginId": "example.native-wgpu", "state": null,
            "restored": { "angle": 1.0 } } }));
    desk.until("desk:ready");
    desk.send(json!({ "type": "desk.message", "surface": SURFACE,
        "message": { "type": "desk:ping", "n": 3 } }));
    assert_eq!(desk.until("desk:pong")["message"]["n"], 3);

    desk.send(json!({ "type": "sleep", "surface": SURFACE }));
    let kept = desk.until("desk:state");
    assert!(kept["message"]["state"]["angle"].as_f64().is_some());
    let status = child.wait().unwrap();
    assert!(status.success(), "{status:?}");
}
