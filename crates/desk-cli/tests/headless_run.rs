//! Run one public brain turn with closed stdin and no display or desktop socket.
#[path = "../../desk-core/tests/common/mod.rs"]
mod fixture;

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

fn cli() -> Command {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_endue"));
    cmd.stdin(Stdio::null())
        .env_remove("DISPLAY")
        .env_remove("WAYLAND_DISPLAY")
        .env_remove("ENDUE_BRAIN_URL")
        .env_remove("DESK_BRAIN_URL")
        .env_remove("ENDUE_BRAIN_TOKEN")
        .env(
            "DESK_SOCKET",
            std::env::temp_dir().join("endue-headless-no-desk.sock"),
        );
    cmd
}

fn failure(out: Output, status: i32, message: &str) {
    assert_eq!(out.status.code(), Some(status));
    assert!(
        out.stdout.is_empty(),
        "a failed turn printed a partial answer"
    );
    let reason = String::from_utf8(out.stderr).unwrap();
    assert!(reason.contains(message), "{reason}");
    assert!(!reason.contains("fixture-only"));
}

// brain-echo issues s1 for its first session. Check its lease immediately after the CLI exits.
fn released(echo: &fixture::Echo) {
    let authority = echo
        .url()
        .strip_prefix("http://")
        .unwrap()
        .split('/')
        .next()
        .unwrap();
    let mut stream = TcpStream::connect(authority).unwrap();
    write!(
        stream,
        "GET /v0/sessions/s1/lease HTTP/1.1\r\nHost: {authority}\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    assert!(response.starts_with("HTTP/1.1 404") && response.contains("has no lease in force"));
}

#[test]
fn runs_one_text_turn_without_a_desktop_and_releases_the_lease() {
    let echo = fixture::Echo::start();
    let out = cli()
        .args(["run", "hello from SSH"])
        .env("ENDUE_BRAIN_URL", echo.url())
        .output()
        .unwrap();
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(out.stdout, b"hello from SSH\n");
    assert!(out.stderr.is_empty());
    released(&echo);
}

#[test]
fn supports_json_and_a_literal_option_in_the_prompt_with_the_existing_url_override() {
    let echo = fixture::Echo::start();
    let out = cli()
        .args(["--json", "run", "--", "--json"])
        .env(
            "DESK_BRAIN_URL",
            echo.url().replace("127.0.0.1", "localhost"),
        )
        .output()
        .unwrap();
    assert!(out.status.success());
    let answer: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(answer, serde_json::json!({"ok":true, "text":"--json"}));
}

#[test]
fn tool_requests_leave_no_partial_answer_and_release_the_lease() {
    let echo = fixture::Echo::start();
    let out = cli()
        .args(["run", "tool: hello"])
        .env("ENDUE_BRAIN_URL", echo.url())
        .output()
        .unwrap();
    failure(out, 1, "tool");
    released(&echo);
}

#[test]
fn missing_input_missing_configuration_and_an_unreachable_runtime_are_actionable() {
    failure(cli().arg("run").output().unwrap(), 2, "prompt");
    failure(cli().args(["run", "  "]).output().unwrap(), 2, "prompt");
    failure(
        cli().args(["run", "hello"]).output().unwrap(),
        1,
        "ENDUE_BRAIN_URL",
    );
    let port = fixture::free_port();
    let before = Instant::now();
    let out = cli()
        .args(["run", "hello"])
        .env("ENDUE_BRAIN_URL", format!("http://127.0.0.1:{port}/v0"))
        .output()
        .unwrap();
    failure(out, 1, "reach");
    assert!(before.elapsed() < Duration::from_secs(15));
}

#[test]
fn a_refusal_reports_authentication_without_echoing_a_bearer_or_the_response() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v0", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = BufReader::new(stream.try_clone().unwrap());
        let mut bearer = false;
        let mut length = 0;
        loop {
            let mut line = String::new();
            let n = request.read_line(&mut line).unwrap();
            if n == 0 || line == "\r\n" {
                break;
            }
            bearer |= line.trim_end() == "Authorization: Bearer fixture-only";
            if let Some(value) = line.strip_prefix("Content-Length: ") {
                length = value.trim().parse().unwrap();
            }
        }
        request.read_exact(&mut vec![0; length]).unwrap();
        assert!(bearer);
        let body = r#"{"code":"unauthorized","message":"fixture-only"}"#;
        write!(
            stream,
            "HTTP/1.1 401 Unauthorized\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
    });
    let out = cli()
        .args(["run", "hello"])
        .env("ENDUE_BRAIN_URL", url)
        .env("ENDUE_BRAIN_TOKEN", "fixture-only")
        .output()
        .unwrap();
    failure(out, 1, "ENDUE_BRAIN_TOKEN");
    server.join().unwrap();
}

#[test]
fn rejects_unsafe_bearer_transport_and_credential_bearing_urls_before_connecting() {
    for (url, token, message) in [
        ("http://brain.example.test/v0", "fixture-only", "HTTPS"),
        (
            "http://127.0.0.1/v0?credential=fixture-only",
            "",
            "ENDUE_BRAIN_URL",
        ),
        (
            "http://127.0.0.1/v0",
            "fixture-only\r\nextra",
            "ENDUE_BRAIN_TOKEN",
        ),
    ] {
        let out = cli()
            .args(["run", "hello"])
            .env("ENDUE_BRAIN_URL", url)
            .env("ENDUE_BRAIN_TOKEN", token)
            .output()
            .unwrap();
        failure(out, 1, message);
    }
}
