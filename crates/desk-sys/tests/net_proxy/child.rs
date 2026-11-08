//! The child process of tests/net_proxy.rs: the test binary again, run with `HTTP_PROXY` set, so the
//! process environment is proven without `set_var` (unsafe in edition 2024).

use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use desk_sys::net::{Request, fetch, sse, ws};

pub const ROLE: &str = "DESK_SYS_TEST_CHILD";
const HOST: &str = "DESK_SYS_TEST_HOST";
const WAIT: Duration = Duration::from_secs(10);
const PROXY_VARS: [&str; 8] = [
    "http_proxy",
    "HTTP_PROXY",
    "https_proxy",
    "HTTPS_PROXY",
    "all_proxy",
    "ALL_PROXY",
    "no_proxy",
    "NO_PROXY",
];

/// Fetch, then open an event stream and a WebSocket, all to `DESK_SYS_TEST_HOST` under the allowlist
/// `desk.test`, printing one line for each: the answer, or the error code.
pub fn run(role: &str) {
    // libtest's "test child ... " starts the first line.
    println!();
    let host = std::env::var(HOST).unwrap();
    let allowed_hosts = vec!["desk.test".to_owned()];
    let timeout = Some(WAIT);
    let code = |err: desk_sys::Error| format!("{:?}", err.code);

    let fetched = fetch(&Request {
        url: format!("http://{host}/"),
        allowed_hosts: allowed_hosts.clone(),
        timeout,
        ..Request::default()
    });
    match fetched {
        Ok(response) => {
            let body = String::from_utf8_lossy(&response.body);
            println!("fetch:{}:{body}", response.status);
        }
        Err(err) => println!("fetch:{}", code(err)),
    }

    let (sender, events) = mpsc::channel();
    let request = sse::Request {
        url: format!("http://{host}/events"),
        allowed_hosts: allowed_hosts.clone(),
        timeout,
        ..sse::Request::default()
    };
    let on_event = move |event| {
        let _ = sender.send(event);
    };
    match sse::open(&request, on_event) {
        Ok(_stream) => match events.recv_timeout(WAIT) {
            Ok(sse::Event::Message(message)) => println!("sse:{}", message.data),
            other => println!("sse:unexpected {other:?}"),
        },
        Err(err) => println!("sse:{}", code(err)),
    }

    let (sender, events) = mpsc::channel();
    let request = ws::Request {
        url: format!("ws://{host}/ws"),
        allowed_hosts,
        timeout,
        ..ws::Request::default()
    };
    let on_event = move |event| {
        let _ = sender.send(event);
    };
    match ws::connect(&request, on_event) {
        Ok(socket) => {
            socket.send(ws::Message::Text("echo".to_owned())).unwrap();
            match events.recv_timeout(WAIT) {
                Ok(ws::Event::Message(ws::Message::Text(text))) => println!("ws:{text}"),
                other => println!("ws:unexpected {other:?}"),
            }
            let _ = socket.close(1000, "");
        }
        Err(err) => println!("ws:{}", code(err)),
    }
    println!("role:{role}:done");
}

/// Run the child against `host` with `HTTP_PROXY` at `proxy_port` and every other proxy variable
/// unset; its standard output.
pub fn spawn(role: &str, host: &str, proxy_port: u16) -> String {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args(["--exact", "child", "--nocapture", "--test-threads=1"])
        .env(ROLE, role)
        .env(HOST, host)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for name in PROXY_VARS {
        command.env_remove(name);
    }
    command.env("HTTP_PROXY", format!("http://127.0.0.1:{proxy_port}"));
    let output = command.output().unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success() && stdout.contains(&format!("role:{role}:done")),
        "the child failed:\n{stdout}\n{stderr}"
    );
    stdout
}
