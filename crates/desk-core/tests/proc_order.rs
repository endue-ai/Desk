//! proc.write is applied by the time it answers: calls made one after another, each on a thread of
//! its own as the CEF shell answers a caller's calls (`apps/desk/shell/src/host/lanes.rs`), reach
//! the program in the order they were made, whatever each carries.
//!
//! The child program is this test binary again (`DESK_CORE_TEST_CHILD` names its role).

mod support;

use std::io::BufRead as _;
use std::sync::Arc;
use std::time::{Duration, Instant};

use desk_core::Core;
use serde_json::{Value, json};
use support::{call, grant, home, roots};

const ROLE: &str = "DESK_CORE_TEST_CHILD";
const TERM: &str = "example.term";
const WAIT: Duration = Duration::from_secs(30);
const WRITES: usize = 100;

/// The child program: says back each line it reads, until `end`.
#[test]
fn child() {
    if std::env::var(ROLE).as_deref() != Ok("lines") {
        return;
    }
    for line in std::io::stdin().lock().lines() {
        let line = line.unwrap();
        if line == "end" {
            break;
        }
        println!("got:{line}");
    }
    std::process::exit(0);
}

fn scope() -> Value {
    let program = std::env::current_exe().unwrap().display().to_string();
    json!({ "permission": "proc:spawn", "commands": [program] })
}

/// Write `i`: its own number and some bytes more, longer for some than others; most writes end the
/// line before them first, every third goes on with it.
fn written(i: usize) -> String {
    let filler = "x".repeat(i * 37 % 700);
    if i.is_multiple_of(3) {
        format!("{i}:{filler}")
    } else {
        format!("-\n{i}:{filler}")
    }
}

#[test]
fn writes_made_one_after_another_reach_the_program_in_that_order() {
    let core = Arc::new(Core::new(roots(&home("proc-order"))));
    grant(&core, TERM, scope());
    let events = core.events().subscribe_addressed();
    let started = call(
        &core,
        TERM,
        "proc.spawn",
        json!({
            "command": std::env::current_exe().unwrap().display().to_string(),
            "args": ["--exact", "child", "--nocapture", "--test-threads=1"],
            "env": { ROLE: "lines" },
            "scope": scope(),
        }),
    )
    .unwrap();
    let proc_id = started["procId"].as_str().unwrap().to_owned();
    let mut sent = String::new();
    for i in 0..WRITES {
        let data = written(i);
        sent.push_str(&data);
        let (core, id) = (Arc::clone(&core), proc_id.clone());
        let params = json!({ "procId": id, "data": data, "scope": scope() });
        std::thread::spawn(move || call(&core, TERM, "proc.write", params))
            .join()
            .unwrap()
            .unwrap();
    }
    let params = json!({ "procId": proc_id, "data": "\nend\n", "scope": scope() });
    call(&core, TERM, "proc.write", params).unwrap();
    sent.push('\n');

    let mut out = String::new();
    let deadline = Instant::now() + WAIT;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        let delivery = events.recv_timeout(left).expect("the program ended");
        let event = serde_json::to_value(&delivery.event).unwrap();
        if event["data"]["procId"] != proc_id.as_str() {
            continue;
        }
        if event["event"] == "proc.exit" {
            break;
        }
        if event["event"] == "proc.output" && event["data"]["stream"] == "stdout" {
            out.push_str(event["data"]["data"].as_str().unwrap_or_default());
        }
    }
    // libtest's `test child ... ` comes before the first line, on the same line.
    let heard: Vec<&str> = (out.lines())
        .filter_map(|l| l.split_once("got:").map(|(_, line)| line))
        .collect();
    let expected: Vec<&str> = sent.lines().collect();
    assert_eq!(heard.len(), expected.len(), "lines heard: {}", heard.len());
    assert!(
        heard == expected,
        "the program heard the writes out of order"
    );
}
