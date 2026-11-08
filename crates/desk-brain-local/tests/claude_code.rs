//! Claude Code as the brain's model (ADR 0109), against a fake `claude`: a shell script that keeps
//! each run's arguments and stdin and prints the next scripted answer. A turn's tools go in the
//! system prompt and the schema, the conversation goes on stdin, a structured answer's calls go out
//! one at a time, and their results come back to Claude Code in the next run's transcript.
#![cfg(unix)]

mod support;

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use desk_brain::{Brain, TextPart, ToolDefinition, TurnRequest, UserMessage};
use desk_brain_local::{ClaudeCodeOptions, LocalBrain};
use serde_json::{Value, json};
use support::{Contract, Folder, kinds, open, submit, text};

const FAKE: &str = r#"#!/bin/sh
dir="$(dirname "$0")"
if [ "$1" = "--version" ]; then echo "9.9.9 (Claude Code)"; exit 0; fi
n=$(ls "$dir" | grep -c '^stdin-')
printf '%s\n' "$@" > "$dir/args-$n"
cat > "$dir/stdin-$n"
cat "$dir/reply-$n.json"
"#;

/// A fake `claude` in `folder/bin`, answering its runs with `replies` in order.
fn fake(folder: &Path, replies: &[Value]) -> PathBuf {
    let bin = folder.join("bin");
    fs::create_dir_all(&bin).unwrap();
    for (n, reply) in replies.iter().enumerate() {
        fs::write(bin.join(format!("reply-{n}.json")), reply.to_string()).unwrap();
    }
    let program = bin.join("claude");
    fs::write(&program, FAKE).unwrap();
    fs::set_permissions(&program, fs::Permissions::from_mode(0o755)).unwrap();
    program
}

fn read(program: &Path, file: &str) -> String {
    fs::read_to_string(program.with_file_name(file)).unwrap()
}

fn turn_request(lease: &str, parts: &[&str]) -> TurnRequest {
    let part = |text: &&str| TextPart {
        r#type: Default::default(),
        text: (*text).to_owned(),
    };
    let tool = ToolDefinition {
        name: "endue_git_state".to_owned(),
        description: "The branch and the changed files. It only reads.".to_owned(),
        schema: json!({ "type": "object", "properties": {} })
            .as_object()
            .cloned()
            .unwrap(),
    };
    TurnRequest {
        lease_id: lease.to_owned(),
        message: UserMessage {
            role: Default::default(),
            content: parts.iter().map(part).collect(),
        },
        tools: Some(vec![tool]),
        tool_choice: None,
        context: None,
    }
}

#[test]
fn a_structured_call_goes_to_the_desk_and_its_result_back_to_claude_code() {
    let folder = Folder::new();
    let program = fake(
        folder.path(),
        &[
            json!({ "type": "result", "is_error": false, "result": "",
                "structured_output": { "say": "", "calls": [
                    { "tool": "endue_git_state", "arguments": { "path": "." } } ] } }),
            json!({ "type": "result", "is_error": false, "result": "",
                "structured_output": { "say": "You are on main; nothing changed.", "calls": [] } }),
        ],
    );
    let options = ClaudeCodeOptions::new(&program).with_model("haiku");
    let brain = LocalBrain::claude_code(folder.path().join("brain"), options).unwrap();
    assert_eq!(brain.model(), "haiku");
    assert_eq!(brain.base_url(), program.display().to_string());
    brain.list_spaces().expect("claude --version answers");
    let (session, lease) = open(&brain, "desk-a");

    let desk =
        "[The desk as the person sees it]\n- w1: Git (endue.git) (focused)\n[The person says:]\n";
    let contract = Contract::new();
    let mut events = Vec::new();
    let request = turn_request(&lease, &[desk, "what changed?"]);
    brain
        .create_turn(&session, &request, &mut |event| {
            let event = serde_json::to_value(event).unwrap();
            contract.check("TurnEvent", &event);
            events.push(event);
        })
        .unwrap();
    assert_eq!(
        kinds(&events),
        ["turn.started", "tool.call", "turn.completed"]
    );
    let call = &events[1]["call"];
    assert_eq!(call["name"], "endue_git_state");
    assert_eq!(call["arguments"], json!({ "path": "." }));
    assert_eq!(events[2]["stopReason"], "tool_call");

    let args = read(&program, "args-0");
    assert!(
        args.starts_with("-p\n--output-format\njson\n--tools\n\n"),
        "{args}"
    );
    assert!(args.contains("\n- endue_git_state: The branch and the changed files."));
    assert!(args.contains("\n--json-schema\n{"));
    assert!(args.ends_with("\n--model\nhaiku\n"));
    let stdin = read(&program, "stdin-0");
    assert!(
        stdin.contains(&format!("Person: {desk}what changed?")),
        "{stdin}"
    );

    let turn_id = events[0]["turnId"].as_str().unwrap().to_owned();
    let call_id = call["callId"].as_str().unwrap().to_owned();
    let output = json!({ "branch": "main", "changed": [] });
    let (result, events) = submit(&brain, &session, &turn_id, &lease, &call_id, output);
    result.unwrap();
    assert_eq!(kinds(&events), ["text.delta", "turn.completed"]);
    assert_eq!(text(&events), "You are on main; nothing changed.");
    let stdin = read(&program, "stdin-1");
    assert!(stdin.contains("\n\nEris called endue_git_state with {\"path\":\".\"}\n\n"));
    let answered = "Tool endue_git_state answered: {\"branch\":\"main\",\"changed\":[]}";
    let other_order = "Tool endue_git_state answered: {\"changed\":[],\"branch\":\"main\"}";
    assert!(
        stdin.contains(answered) || stdin.contains(other_order),
        "{stdin}"
    );
}

#[test]
fn a_claude_code_that_is_not_installed_is_unreachable() {
    let folder = Folder::new();
    let missing = folder.path().join("nowhere/claude");
    let brain = LocalBrain::claude_code(folder.path(), ClaudeCodeOptions::new(missing)).unwrap();
    assert_eq!(brain.model(), "claude");
    assert!(matches!(
        brain.list_spaces(),
        Err(desk_brain::BrainFailure::Unreachable(_))
    ));
    let (session, lease) = open(&brain, "desk-a");
    let failed = brain.create_turn(&session, &turn_request(&lease, &["hi"]), &mut |_| {});
    assert!(matches!(
        failed,
        Err(desk_brain::BrainFailure::Unreachable(_))
    ));
}

/// The person's real Claude Code, signed in: one turn that must call the offered tool, then words.
/// People run it: `cargo test -p desk-brain-local --test claude_code -- --ignored`.
#[test]
#[ignore = "runs the installed Claude Code, which needs its sign-in and the network"]
fn the_installed_claude_code_calls_the_tool_the_desk_points_at_then_answers() {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let program = desk_brain_local::find_claude(std::env::var_os("PATH"), home)
        .expect("Claude Code is installed");
    let folder = Folder::new();
    let options = ClaudeCodeOptions::new(program).with_model("haiku");
    let brain = LocalBrain::claude_code(folder.path(), options).unwrap();
    let (session, lease) = open(&brain, "desk-a");
    let desk = "[The desk as the person sees it while saying the line below.]\n\
        Screen 1440×900, 1 window(s), front to back:\n\
        - w1: Git (endue.git) (focused), right, at 760,40 size 640×800\n  \
        endue.git tools: endue_git_state\n[The person says:]\n";
    let mut events = Vec::new();
    let request = turn_request(&lease, &[desk, "What changed in this repository?"]);
    let mut keep = |e| events.push(serde_json::to_value(e).unwrap());
    brain.create_turn(&session, &request, &mut keep).unwrap();
    let kinds_seen = kinds(&events);
    assert_eq!(
        kinds_seen,
        ["turn.started", "tool.call", "turn.completed"],
        "{events:?}"
    );
    assert_eq!(events[1]["call"]["name"], "endue_git_state");
    let turn_id = events[0]["turnId"].as_str().unwrap().to_owned();
    let call_id = events[1]["call"]["callId"].as_str().unwrap().to_owned();
    let output = json!({ "branch": "main", "changed": ["README.md"] });
    let (result, events) = submit(&brain, &session, &turn_id, &lease, &call_id, output);
    result.unwrap();
    assert_eq!(
        kinds(&events),
        ["text.delta", "turn.completed"],
        "{events:?}"
    );
    let said = text(&events);
    println!("Claude Code said: {said}");
    assert!(said.contains("README"), "{said}");
}
