//! The agent programs on this computer (ADR 0110): agents.* finds Claude Code and Codex by their
//! data folders and programs, lists their sessions from the files they keep (Codex's compressed
//! ones and the sessions the Claude desktop app archived among them), reads a session's turns,
//! copies sessions into the desk's folder, and runs a program for a work request, read-only by
//! default, reporting each step as agents.run. Every call needs agents:manage. Fixture data only.

mod support;

use std::fs;
use std::path::{Path, PathBuf};

use desk_core::{Core, LocalAgents, LocalAgentsOptions};
use serde_json::{Value, json};
use support::*;

const CLAUDE_LIVE: &str = "11111111-1111-4111-8111-111111111111";
const CLAUDE_OLD: &str = "22222222-2222-4222-8222-222222222222";
const CODEX_LIVE: &str = "33333333-3333-4333-8333-333333333333";
const CODEX_OLD: &str = "44444444-4444-4444-8444-444444444444";

fn lines(values: &[Value]) -> String {
    values.iter().map(|v| format!("{v}\n")).collect()
}

/// A home with Claude Code's and Codex's folders: one live and one archived session each.
fn fixture(tag: &str) -> PathBuf {
    let home = home(tag);
    let project = home.join(".claude/projects/-work-app");
    fs::create_dir_all(&project).unwrap();
    let live = lines(&[
        json!({ "type": "user", "sessionId": CLAUDE_LIVE, "timestamp": "2026-11-04T10:00:00.120Z",
            "cwd": "/work/app", "gitBranch": "main", "version": "2.4.1",
            "message": { "role": "user", "content": "Why does the upload test fail?" } }),
        json!({ "type": "assistant", "timestamp": "2026-11-04T10:01:00Z", "cwd": "/work/app",
            "message": { "role": "assistant", "model": "claude-opus-5-5", "content": [
                { "type": "thinking", "thinking": "hidden" },
                { "type": "text", "text": "Let me look." },
                { "type": "tool_use", "name": "Bash", "input": { "command": "pnpm test upload" } }] } }),
        json!({ "type": "user", "timestamp": "2026-11-04T10:01:30Z",
            "message": { "role": "user", "content": [{ "type": "tool_result", "content": "1 failed" }] } }),
        json!({ "type": "assistant", "timestamp": "2026-11-04T10:02:00Z",
            "message": { "role": "assistant", "content": [{ "type": "text", "text": "It waits on a timer." }] } }),
        json!({ "type": "ai-title", "aiTitle": "Flaky upload test", "sessionId": CLAUDE_LIVE }),
    ]);
    fs::write(project.join(format!("{CLAUDE_LIVE}.jsonl")), live).unwrap();
    let old = lines(&[
        json!({ "type": "user", "timestamp": "2026-10-01T08:00:00Z", "cwd": "/work/old",
        "message": { "role": "user", "content": "Tidy the readme" } }),
    ]);
    fs::write(project.join(format!("{CLAUDE_OLD}.jsonl")), old).unwrap();
    fs::create_dir_all(project.join(CLAUDE_LIVE).join("subagents")).unwrap();
    let desktop = home.join("AppData/Claude/claude-code-sessions/acc/org");
    fs::create_dir_all(&desktop).unwrap();
    let meta = json!({ "sessionId": "local_x", "cliSessionId": CLAUDE_OLD, "isArchived": true,
        "title": "Readme tidy-up", "lastActivityAt": 1_791_014_400_000_u64 });
    fs::write(desktop.join("local_x.json"), meta.to_string()).unwrap();

    let day = home.join(".codex/sessions/2026/11/04");
    fs::create_dir_all(&day).unwrap();
    let rollout = |id: &str, cwd: &str, prompt: &str, answer: &str| {
        lines(&[
            json!({ "timestamp": "2026-11-04T09:00:00.5Z", "type": "session_meta", "payload": {
                "id": id, "cwd": cwd, "timestamp": "2026-11-04T09:00:00Z", "cli_version": "0.80.0",
                "git": { "branch": "feature/loader" } } }),
            json!({ "timestamp": "2026-11-04T09:00:01Z", "type": "turn_context", "payload": { "model": "gpt-6" } }),
            json!({ "timestamp": "2026-11-04T09:00:02Z", "type": "response_item", "payload": {
                "type": "message", "role": "user",
                "content": [{ "type": "input_text", "text": "<environment_context>x</environment_context>" }] } }),
            json!({ "timestamp": "2026-11-04T09:00:03Z", "type": "response_item", "payload": {
                "type": "message", "role": "user", "content": [{ "type": "input_text", "text": prompt }] } }),
            json!({ "timestamp": "2026-11-04T09:00:04Z", "type": "response_item", "payload": {
                "type": "function_call", "name": "shell", "arguments": "{\"command\":\"cargo test\"}" } }),
            json!({ "timestamp": "2026-11-04T09:05:00Z", "type": "response_item", "payload": {
                "type": "message", "role": "assistant", "content": [{ "type": "output_text", "text": answer }] } }),
        ])
    };
    let name = format!("rollout-2026-11-04T09-00-00-{CODEX_LIVE}.jsonl");
    fs::write(
        day.join(name),
        rollout(CODEX_LIVE, "/work/app", "Rename the loader", "Renamed."),
    )
    .unwrap();
    let archive = home.join(".codex/archived_sessions");
    fs::create_dir_all(&archive).unwrap();
    let text = rollout(
        CODEX_OLD,
        "/work/parser",
        "Speed up the parser",
        "Twice as fast.",
    );
    let packed = ruzstd::encoding::compress_to_vec(
        text.as_bytes(),
        ruzstd::encoding::CompressionLevel::Fastest,
    );
    let name = format!("rollout-2026-10-02T09-00-00-{CODEX_OLD}.jsonl.zst");
    fs::write(archive.join(name), packed).unwrap();
    let index = lines(&[
        json!({ "id": CODEX_LIVE, "thread_name": "Loader rename", "updated_at": "2026-11-04T09:10:00Z" }),
    ]);
    fs::write(home.join(".codex/session_index.jsonl"), index).unwrap();
    home
}

fn options(home: &Path, bin: Option<PathBuf>) -> LocalAgentsOptions {
    LocalAgentsOptions {
        home: home.to_path_buf(),
        claude_home: home.join(".claude"),
        codex_home: home.join(".codex"),
        app_data: Some(home.join("AppData")),
        data: Some(home.join("data/agents")),
        path: None,
        extra_path: bin.into_iter().collect(),
    }
}

fn desk(home: &Path, bin: Option<PathBuf>) -> Core {
    let core = Core::new(roots(home)).with_local_agents(LocalAgents::new(options(home, bin)));
    grant(&core, "desk", json!({ "permission": "agents:manage" }));
    core
}

fn scope() -> Value {
    json!({ "permission": "agents:manage" })
}

fn agents(core: &Core, method: &str, mut params: Value) -> Result<Value, desk_bridge::BridgeError> {
    params["scope"] = scope();
    call(core, "desk", method, params)
}

#[test]
fn agents_calls_need_agents_manage_and_local_agents() {
    let home = fixture("agents-perm");
    let core = Core::new(roots(&home)).with_local_agents(LocalAgents::new(options(&home, None)));
    let refused = call(
        &core,
        "example.notes",
        "agents.list",
        json!({ "scope": scope() }),
    )
    .unwrap_err();
    assert_eq!(
        serde_json::to_value(refused.code).unwrap(),
        "permission_denied"
    );
    let bare = Core::new(roots(&home));
    grant(&bare, "desk", scope());
    let unsupported = call(&bare, "desk", "agents.list", json!({ "scope": scope() })).unwrap_err();
    assert_eq!(
        serde_json::to_value(unsupported.code).unwrap(),
        "unsupported"
    );
}

#[test]
fn the_agents_found_carry_their_counts_and_the_newest_version() {
    let home = fixture("agents-list");
    let core = desk(&home, None);
    let listed = agents(&core, "agents.list", json!({})).unwrap();
    let found = listed["agents"].as_array().unwrap();
    assert_eq!(found.len(), 2);
    assert_eq!(found[0]["id"], "claude");
    assert_eq!(found[0]["name"], "Claude Code");
    assert_eq!(
        (found[0]["sessions"].clone(), found[0]["archived"].clone()),
        (json!(1), json!(1))
    );
    assert_eq!(found[0]["version"], "2.4.1");
    assert!(found[0].get("program").is_none());
    assert_eq!(found[1]["id"], "codex");
    assert_eq!(
        (found[1]["sessions"].clone(), found[1]["archived"].clone()),
        (json!(1), json!(1))
    );
    assert_eq!(found[1]["version"], "0.80.0");

    let empty = home.join("nobody");
    fs::create_dir_all(&empty).unwrap();
    let none = core_without_agents(&empty);
    assert_eq!(
        agents(&none, "agents.list", json!({})).unwrap(),
        json!({ "agents": [] })
    );
    let missing = agents(&none, "agents.sessions", json!({ "agent": "codex" })).unwrap_err();
    assert_eq!(serde_json::to_value(missing.code).unwrap(), "not_found");
}

fn core_without_agents(home: &Path) -> Core {
    let core = Core::new(roots(home)).with_local_agents(LocalAgents::new(options(home, None)));
    grant(&core, "desk", scope());
    core
}

#[test]
fn sessions_come_from_the_programs_files_and_their_archives() {
    let home = fixture("agents-sessions");
    let core = desk(&home, None);
    let live = agents(&core, "agents.sessions", json!({ "agent": "claude" })).unwrap();
    assert_eq!(live["total"], 1);
    let session = &live["sessions"][0];
    assert_eq!(session["id"], CLAUDE_LIVE);
    assert_eq!(session["title"], "Flaky upload test");
    assert_eq!(session["cwd"], "/work/app");
    assert_eq!(session["branch"], "main");
    assert_eq!(session["startedAt"], "2026-11-04T10:00:00Z");
    assert_eq!(session["updatedAt"], "2026-11-04T10:02:00Z");
    assert_eq!(session["model"], "claude-opus-5-5");
    assert_eq!(session["archived"], false);

    let archived = agents(
        &core,
        "agents.sessions",
        json!({ "agent": "claude", "from": "archive" }),
    )
    .unwrap();
    assert_eq!(archived["sessions"][0]["id"], CLAUDE_OLD);
    assert_eq!(archived["sessions"][0]["title"], "Readme tidy-up");
    assert_eq!(archived["sessions"][0]["archived"], true);

    let codex = agents(&core, "agents.sessions", json!({ "agent": "codex" })).unwrap();
    assert_eq!(codex["sessions"][0]["title"], "Loader rename");
    assert_eq!(codex["sessions"][0]["updatedAt"], "2026-11-04T09:10:00Z");
    assert_eq!(codex["sessions"][0]["branch"], "feature/loader");
    let packed = agents(
        &core,
        "agents.sessions",
        json!({ "agent": "codex", "from": "archive" }),
    )
    .unwrap();
    assert_eq!(packed["sessions"][0]["id"], CODEX_OLD);
    assert_eq!(packed["sessions"][0]["title"], "Speed up the parser");
    assert_eq!(packed["sessions"][0]["cwd"], "/work/parser");

    let query = json!({ "agent": "codex", "from": "archive", "query": "PARSER speed" });
    assert_eq!(agents(&core, "agents.sessions", query).unwrap()["total"], 1);
    let none = json!({ "agent": "codex", "query": "parser" });
    assert_eq!(agents(&core, "agents.sessions", none).unwrap()["total"], 0);
    let paged = json!({ "agent": "claude", "offset": 1 });
    let page = agents(&core, "agents.sessions", paged).unwrap();
    assert_eq!(
        (page["total"].clone(), page["sessions"].clone()),
        (json!(1), json!([]))
    );
}

#[test]
fn a_transcript_holds_the_turns_and_the_tools_but_not_the_programs_own_lines() {
    let home = fixture("agents-transcript");
    let core = desk(&home, None);
    let read = json!({ "agent": "claude", "sessionId": CLAUDE_LIVE });
    let transcript = agents(&core, "agents.transcript", read).unwrap();
    let turns: Vec<(String, String)> = transcript["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| {
            (
                m["role"].as_str().unwrap().to_owned(),
                m["text"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    let expected = [
        ("user", "Why does the upload test fail?"),
        ("assistant", "Let me look."),
        ("tool", "pnpm test upload"),
        ("assistant", "It waits on a timer."),
    ];
    let expected: Vec<(String, String)> = expected
        .iter()
        .map(|(r, t)| ((*r).to_owned(), (*t).to_owned()))
        .collect();
    assert_eq!(turns, expected);
    assert_eq!(transcript["messages"][2]["name"], "Bash");
    assert_eq!(transcript["truncated"], false);

    let last = json!({ "agent": "codex", "sessionId": CODEX_OLD, "limit": 2 });
    let packed = agents(&core, "agents.transcript", last).unwrap();
    assert_eq!(packed["truncated"], true);
    assert_eq!(packed["messages"][0]["name"], "shell");
    assert_eq!(packed["messages"][0]["text"], "cargo test");
    assert_eq!(packed["messages"][1]["text"], "Twice as fast.");

    let unknown = json!({ "agent": "codex", "sessionId": "99999999-9999-4999-8999-999999999999" });
    let missing = agents(&core, "agents.transcript", unknown).unwrap_err();
    assert_eq!(serde_json::to_value(missing.code).unwrap(), "not_found");
}

#[test]
fn an_import_copies_sessions_into_the_desk_once_and_they_outlive_their_files() {
    let home = fixture("agents-import");
    let core = desk(&home, None);
    let deliveries = core.events().subscribe_addressed();
    let first = agents(
        &core,
        "agents.import",
        json!({ "agent": "codex", "from": "archive" }),
    )
    .unwrap();
    assert_eq!(first, json!({ "imported": 1, "unchanged": 0, "failed": 0 }));
    let changed = wait_for(&deliveries, "agents.changed");
    assert_eq!(changed.data(), &json!({ "agent": "codex" }));
    assert!(changed.is_for("desk"));
    let again = agents(
        &core,
        "agents.import",
        json!({ "agent": "codex", "from": "archive" }),
    )
    .unwrap();
    assert_eq!(again, json!({ "imported": 0, "unchanged": 1, "failed": 0 }));
    assert!(named(&deliveries, "agents.changed").is_empty());

    let listed = agents(
        &core,
        "agents.sessions",
        json!({ "agent": "codex", "from": "archive" }),
    )
    .unwrap();
    assert_eq!(listed["sessions"][0]["imported"], true);
    assert!(listed["sessions"][0]["importedAt"].is_string());

    fs::remove_dir_all(home.join(".codex/archived_sessions")).unwrap();
    let kept = agents(
        &core,
        "agents.sessions",
        json!({ "agent": "codex", "from": "desk" }),
    )
    .unwrap();
    assert_eq!(kept["sessions"][0]["id"], CODEX_OLD);
    let read = json!({ "agent": "codex", "sessionId": CODEX_OLD });
    let copy = agents(&core, "agents.transcript", read).unwrap();
    assert_eq!(
        copy["messages"].as_array().unwrap().last().unwrap()["text"],
        "Twice as fast."
    );

    // A new desk on the same folder still holds the copy.
    let later = desk(&home, None);
    let listed = agents(&later, "agents.list", json!({})).unwrap();
    assert_eq!(listed["agents"][1]["imported"], 1);

    let some = json!({ "agent": "claude", "sessionIds": [CLAUDE_LIVE, "55555555-5555-4555-8555-555555555555"] });
    assert_eq!(
        agents(&core, "agents.import", some).unwrap(),
        json!({ "imported": 1, "unchanged": 0, "failed": 1 })
    );
    let from_desk = agents(
        &core,
        "agents.import",
        json!({ "agent": "claude", "from": "desk" }),
    )
    .unwrap_err();
    assert_eq!(
        serde_json::to_value(from_desk.code).unwrap(),
        "invalid_params"
    );
}

#[test]
fn asking_an_agent_without_its_program_is_unsupported() {
    let home = fixture("agents-no-program");
    let core = desk(&home, None);
    let ask = json!({ "agent": "codex", "prompt": "hi" });
    let failed = agents(&core, "agents.ask", ask).unwrap_err();
    assert_eq!(serde_json::to_value(failed.code).unwrap(), "unsupported");
}
