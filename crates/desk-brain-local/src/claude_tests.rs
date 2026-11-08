use std::fs;

use serde_json::json;

use super::*;

fn tool(name: &str) -> Value {
    json!({ "type": "function", "function": { "name": name, "description": "Does it.",
        "parameters": { "type": "object" } } })
}

fn ok(stdout: Value) -> Output {
    Output {
        success: true,
        stdout: stdout.to_string(),
        stderr: String::new(),
    }
}

fn code(failure: BrainFailure) -> Option<(u16, BrainErrorCode)> {
    match failure {
        BrainFailure::Refused { status, error } => Some((status, error.code)),
        _ => None,
    }
}

#[test]
fn claude_code_always_runs_without_its_own_tools_and_never_prompts() {
    let options = ClaudeCodeOptions::new("/bin/claude").with_model("haiku");
    let args = arguments(&options, &[tool("endue_git_state")], false);
    let at = args.iter().position(|a| a == "--tools").unwrap();
    assert_eq!(args[at + 1], "", "no built-in tool");
    for flag in [
        "-p",
        "--strict-mcp-config",
        "--safe-mode",
        "--no-session-persistence",
    ] {
        assert!(args.contains(&flag.to_owned()), "{flag}");
    }
    let at = args.iter().position(|a| a == "--permission-mode").unwrap();
    assert_eq!(args[at + 1], "dontAsk");
    assert!(args.windows(2).any(|w| w == ["--model", "haiku"]));
    assert!(args.contains(&"--json-schema".to_owned()));
    let plain = arguments(&ClaudeCodeOptions::new("/bin/claude"), &[], false);
    assert!(
        !plain.contains(&"--json-schema".to_owned()),
        "no tools, no schema"
    );
    assert!(
        !plain.contains(&"--model".to_owned()),
        "Claude Code's own model"
    );
    assert_eq!(ClaudeCodeOptions::new("c").with_model("  ").model, None);
}

#[test]
fn a_structured_answer_gives_calls_or_words() {
    let calls = ok(json!({ "type": "result", "is_error": false, "result": "{}",
        "structured_output": { "say": "Looking.", "calls": [
            { "tool": "endue_git_state", "arguments": {} } ] } }));
    let answer = read(&calls, false).unwrap();
    assert_eq!(answer.stop, StopReason::ToolCall);
    assert_eq!(answer.calls[0].name, "endue_git_state");
    assert_eq!(
        answer.text, "Looking.",
        "kept for the conversation, not said"
    );

    let words = ok(json!({ "is_error": false, "result": "x",
        "structured_output": { "say": "Two files changed.", "calls": [] } }));
    let answer = read(&words, false).unwrap();
    assert_eq!(
        (answer.text.as_str(), answer.stop),
        ("Two files changed.", StopReason::EndTurn)
    );

    let plain = ok(json!({ "is_error": false, "result": " Hello. ", "stop_reason": "max_tokens" }));
    let answer = read(&plain, true).unwrap();
    assert_eq!(
        (answer.text.as_str(), answer.stop),
        ("Hello.", StopReason::MaxTokens)
    );

    let listed = ok(json!([{ "type": "system" }, { "type": "result", "result": "Hi." }]));
    assert_eq!(read(&listed, true).unwrap().text, "Hi.");

    let nothing = ok(json!({ "is_error": false, "result": "" }));
    assert!(matches!(
        read(&nothing, true),
        Err(BrainFailure::Protocol(_))
    ));
}

#[test]
fn failures_map_onto_what_the_desk_does_next() {
    let error = |status: Value| {
        ok(json!({ "is_error": true, "result": "API Error", "api_error_status": status }))
    };
    // Offline or overloaded: unreachable, so the local brain may stand in (ADR 0094).
    assert!(matches!(
        read(&error(Value::Null), false),
        Err(BrainFailure::Unreachable(_))
    ));
    assert!(matches!(
        read(&error(json!(529)), false),
        Err(BrainFailure::Unreachable(_))
    ));
    let limited = code(read(&error(json!(429)), false).unwrap_err());
    assert_eq!(limited, Some((429, BrainErrorCode::RateLimited)));
    // Not signed in to Claude: refused, but not endue ID's sign-in.
    let signed_out = code(read(&error(json!(401)), false).unwrap_err());
    assert_eq!(signed_out, Some((401, BrainErrorCode::Internal)));

    let old = Output {
        success: false,
        stdout: String::new(),
        stderr: "error: unknown option '--safe-mode'\n".to_owned(),
    };
    let refused = code(read(&old, false).unwrap_err());
    assert_eq!(refused, Some((400, BrainErrorCode::InvalidRequest)));
    let crashed = Output {
        success: false,
        stdout: "not json".to_owned(),
        stderr: "\n Connection refused\n".to_owned(),
    };
    let BrainFailure::Unreachable(why) = read(&crashed, false).unwrap_err() else {
        panic!("a crash is unreachable");
    };
    assert_eq!(why, "Claude Code stopped: Connection refused");
}

#[test]
fn claude_is_found_on_the_path_or_in_the_folders_installers_use() {
    let root = std::env::temp_dir().join(format!("desk-find-claude-{}", std::process::id()));
    let (on_path, home) = (root.join("bin"), root.join("home"));
    fs::create_dir_all(&on_path).unwrap();
    fs::create_dir_all(home.join(".local/bin")).unwrap();
    let name = if cfg!(windows) {
        "claude.exe"
    } else {
        "claude"
    };
    fs::write(home.join(".local/bin").join(name), "").unwrap();
    let path = Some(on_path.clone().into_os_string());
    assert_eq!(
        find_claude(path.clone(), Some(home.clone())),
        Some(home.join(".local/bin").join(name))
    );
    fs::write(on_path.join(name), "").unwrap();
    assert_eq!(find_claude(path, Some(home)), Some(on_path.join(name)));
    fs::remove_dir_all(&root).unwrap();
}
