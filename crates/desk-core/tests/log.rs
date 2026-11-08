//! log.write and log.tail: one channel per caller stamped by the core, one ring of the latest
//! 10 000 entries over every channel, `desk.log` in the logs folder rotated by size, secret-looking
//! fields masked before storing, and `log.entry` on the bus.

mod support;

use std::collections::BTreeSet;
use std::fs;

use desk_bridge::{BridgeError, ErrorCode, LogLevel};
use desk_core::Core;
use serde_json::{Value, json};
use support::*;

const HELLO: &str = "example.hello";
const WATCHER: &str = "example.watcher";
const NOSY: &str = "example.nosy";

fn log_read() -> Value {
    json!({ "permission": "log:read" })
}

fn write(core: &Core, caller: &str, message: &str) -> Result<Value, BridgeError> {
    let params = json!({ "level": "info", "message": message });
    call(core, caller, "log.write", params)
}

/// log.tail as `desk`, which holds log:read; `params` without the scope.
fn tail(core: &Core, mut params: Value) -> Vec<Value> {
    params["scope"] = log_read();
    let tailed = call(core, "desk", "log.tail", params).unwrap();
    tailed["entries"].as_array().unwrap().clone()
}

fn messages(entries: &[Value]) -> Vec<&str> {
    entries
        .iter()
        .map(|e| e["message"].as_str().unwrap())
        .collect()
}

/// Every `log.entry` on the bus so far, as its data.
fn logged(events: &std::sync::mpsc::Receiver<desk_bridge::BridgeEvent>) -> Vec<Value> {
    std::iter::from_fn(|| events.try_recv().ok())
        .map(|event| serde_json::to_value(event).unwrap())
        .filter(|event| event["event"] == "log.entry")
        .map(|event| event["data"].clone())
        .collect()
}

/// `YYYY-MM-DDTHH:MM:SS.mmmZ`.
fn stamped_with_milliseconds(at: &str) -> bool {
    let shape = "dddd-dd-ddTdd:dd:dd.dddZ";
    at.len() == shape.len()
        && at
            .chars()
            .zip(shape.chars())
            .all(|(c, s)| if s == 'd' { c.is_ascii_digit() } else { c == s })
}

#[test]
fn a_write_is_stamped_and_tail_needs_log_read() {
    let core = Core::new(roots(&home("log-stamp")));
    let params = json!({ "level": "info", "message": "hi", "fields": { "n": 1 } });
    assert_eq!(call(&core, HELLO, "log.write", params).unwrap(), json!({}));

    let denied = call(&core, "desk", "log.tail", json!({ "scope": log_read() })).unwrap_err();
    assert_eq!(denied.code, ErrorCode::PermissionDenied);
    assert_eq!(serde_json::to_value(denied.permission).unwrap(), log_read());

    grant(&core, "desk", log_read());
    let entries = tail(&core, json!({}));
    assert_eq!(entries.len(), 1);
    let entry = &entries[0];
    assert_eq!(entry["channel"], HELLO);
    assert_eq!(entry["level"], "info");
    assert_eq!(entry["message"], "hi");
    assert_eq!(entry["fields"], json!({ "n": 1 }));
    let at = entry["at"].as_str().unwrap();
    assert!(stamped_with_milliseconds(at), "{at}");
}

#[test]
fn tail_merges_channels_in_write_order_oldest_first_and_filters_by_channel() {
    let core = Core::new(roots(&home("log-merge")));
    let writes = [
        ("example.a", "1"),
        ("example.b", "2"),
        ("example.c", "3"),
        ("example.a", "4"),
        ("example.b", "5"),
        ("example.c", "6"),
    ];
    for (caller, message) in writes {
        write(&core, caller, message).unwrap();
    }
    grant(&core, "desk", log_read());
    let all = tail(&core, json!({}));
    let seen: Vec<(&str, &str)> = all
        .iter()
        .map(|e| {
            (
                e["channel"].as_str().unwrap(),
                e["message"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(seen, writes);
    let b = tail(&core, json!({ "channel": "example.b" }));
    assert_eq!(messages(&b), ["2", "5"]);
}

#[test]
fn count_defaults_to_100_and_is_at_most_1000() {
    let core = Core::new(roots(&home("log-count")));
    for n in 1..=150 {
        write(&core, HELLO, &format!("m{n}")).unwrap();
    }
    grant(&core, "desk", log_read());
    let latest = tail(&core, json!({}));
    assert_eq!(latest.len(), 100);
    assert_eq!(latest[0]["message"], "m51");
    assert_eq!(latest[99]["message"], "m150");
    assert_eq!(tail(&core, json!({ "count": 1000 })).len(), 150);
    for count in [0, 1001] {
        let params = json!({ "count": count, "scope": log_read() });
        let refused = call(&core, "desk", "log.tail", params).unwrap_err();
        assert_eq!(refused.code, ErrorCode::InvalidParams, "count {count}");
    }
}

#[test]
fn the_ring_keeps_the_latest_10_000_entries() {
    let core = Core::new(roots(&home("log-ring")));
    for n in 1..=100 {
        write(&core, "example.old", &format!("old {n}")).unwrap();
    }
    for n in 1..=9_950 {
        write(&core, "example.new", &format!("new {n}")).unwrap();
    }
    grant(&core, "desk", log_read());
    let old = tail(&core, json!({ "channel": "example.old" }));
    assert_eq!(old.len(), 50);
    assert_eq!(old[0]["message"], "old 51");
    assert_eq!(old[49]["message"], "old 100");
}

#[test]
fn fields_named_like_secrets_are_masked_before_storing() {
    let home = home("log-mask");
    let dir = home.join("logs");
    let core = Core::new(roots(&home)).with_log_dir(dir.clone());
    let events = core.events().subscribe();
    let fields = json!({
        "token": "abc", "nested": { "password": "p", "keep": 1 },
        "list": [{ "authorization": "Bearer x" }], "Secret_Key": "s", "note": "a token in text",
        "accessToken": "t", "Cookie": "c", "x-api-key": "k", "apikey": "k", "api_key": "k",
        "passwd": "p", "count": 2 });
    let params = json!({ "level": "warn", "message": "signed in", "fields": fields });
    call(&core, HELLO, "log.write", params).unwrap();

    let masked = json!({
        "token": "***", "nested": { "password": "***", "keep": 1 },
        "list": [{ "authorization": "***" }], "Secret_Key": "***", "note": "a token in text",
        "accessToken": "***", "Cookie": "***", "x-api-key": "***", "apikey": "***",
        "api_key": "***", "passwd": "***", "count": 2 });
    grant(&core, "desk", log_read());
    assert_eq!(tail(&core, json!({}))[0]["fields"], masked);
    let event = logged(&events);
    assert_eq!(event.len(), 1);
    assert_eq!(event[0]["fields"], masked);
    let file = fs::read_to_string(dir.join("desk.log")).unwrap();
    assert!(file.contains("signed in"), "{file}");
    for secret in ["abc", "Bearer x", "\"p\"", "\"k\""] {
        assert!(!file.contains(secret), "{secret} reached desk.log");
    }
}

#[test]
fn log_entry_reaches_the_bus_for_every_write() {
    let core = Core::new(roots(&home("log-bus")));
    let events = core.events().subscribe();
    for message in ["one", "two", "three"] {
        write(&core, HELLO, message).unwrap();
    }
    grant(&core, "desk", log_read());
    let seen = logged(&events);
    assert_eq!(seen.len(), 3);
    assert_eq!(seen, tail(&core, json!({})));
}

#[test]
fn log_entry_is_for_subscribers_that_hold_log_read() {
    let core = Core::new(roots(&home("log-to")));
    let names = ["log.entry"];
    let subscribe = json!({ "names": names,
        "scope": { "permission": "events:subscribe", "names": names } });
    for caller in [WATCHER, NOSY] {
        grant(&core, caller, subscribe["scope"].clone());
        call(&core, caller, "events.subscribe", subscribe.clone()).unwrap();
    }
    grant(&core, WATCHER, log_read());
    let deliveries = core.events().subscribe_addressed();
    write(&core, HELLO, "hi").unwrap();
    let seen = named(&deliveries, "log.entry");
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].to, strings(&[WATCHER]));
}

#[test]
fn messages_must_be_1_to_8000_chars() {
    let core = Core::new(roots(&home("log-length")));
    for message in [String::new(), "x".repeat(8_001)] {
        let refused = write(&core, HELLO, &message).unwrap_err();
        assert_eq!(refused.code, ErrorCode::InvalidParams, "{}", message.len());
    }
    write(&core, HELLO, &"x".repeat(8_000)).unwrap();
    write(&core, HELLO, &"é".repeat(8_000)).unwrap();
    grant(&core, "desk", log_read());
    assert_eq!(tail(&core, json!({})).len(), 2);
}

#[test]
fn the_core_writes_to_the_core_channel() {
    let core = Core::new(roots(&home("log-core")));
    core.log(LogLevel::Warn, "started", None);
    write(&core, HELLO, "hi").unwrap();
    grant(&core, "desk", log_read());
    let entries = tail(&core, json!({ "channel": "core" }));
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["channel"], "core");
    assert_eq!(entries[0]["level"], "warn");
    assert_eq!(entries[0]["message"], "started");
}

#[test]
fn a_new_core_over_the_same_folder_tails_a_rotated_log() {
    let home = home("log-rotate");
    let dir = home.join("logs");
    let core = Core::new(roots(&home)).with_log_dir(dir.clone());
    let message = |n: usize| format!("{n:05} {}", "x".repeat(7_994));
    let mut written = 0;
    while !dir.join("desk.log.1").exists() {
        written += 1;
        assert!(written < 2_000, "desk.log never rotated");
        write(&core, HELLO, &message(written)).unwrap();
    }
    for _ in 0..20 {
        written += 1;
        write(&core, HELLO, &message(written)).unwrap();
    }
    drop(core);
    let files: BTreeSet<String> = fs::read_dir(&dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        files,
        BTreeSet::from(["desk.log".into(), "desk.log.1".into()])
    );
    assert!(fs::metadata(dir.join("desk.log.1")).unwrap().len() <= 4 * 1024 * 1024);

    let again = Core::new(roots(&home)).with_log_dir(dir.clone());
    grant(&again, "desk", log_read());
    let entries = tail(&again, json!({ "count": 1000 }));
    let numbers: Vec<usize> = messages(&entries)
        .iter()
        .map(|m| m[..5].parse().unwrap())
        .collect();
    assert_eq!(numbers, (1..=written).collect::<Vec<_>>());

    let lines = || fs::read_to_string(dir.join("desk.log")).unwrap();
    let before = lines().lines().count();
    write(&again, HELLO, "after the restart").unwrap();
    let after = lines();
    assert_eq!(after.lines().count(), before + 1);
    assert!(after.lines().last().unwrap().contains("after the restart"));
}
