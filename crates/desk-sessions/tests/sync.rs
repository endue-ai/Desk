//! sync over a made-up home: Claude Code and Codex transcripts as the programs write them, read
//! into agent-session items; only what changed is read again; gone transcripts remove their items.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use desk_bridge::{AgentLinkKind, AgentLinkPlace, AgentLinkRel, AgentSessionFields, Item};
use desk_sessions::{MASK, Roots, Seen, sync};
use serde_json::{Value, json};

const MAIN: &str = "11111111-1111-4111-8111-111111111111";
const CODEX: &str = "22222222-2222-4222-8222-222222222222";

fn home(tag: &str) -> PathBuf {
    static N: AtomicUsize = AtomicUsize::new(0);
    let n = N.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("desk-sessions-{tag}-{}-{n}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn roots(home: &Path) -> Roots {
    Roots {
        home: home.to_path_buf(),
        claude: home.join(".claude"),
        codex: home.join(".codex"),
    }
}

fn lines(path: &Path, records: &[Value]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let text: String = records.iter().map(|r| format!("{r}\n")).collect();
    fs::write(path, text).unwrap();
}

fn claude_main(home: &Path) -> PathBuf {
    home.join(format!(".claude/projects/-work-desk/{MAIN}.jsonl"))
}

fn codex_file(home: &Path) -> PathBuf {
    home.join(format!(
        ".codex/sessions/2026/11/03/rollout-2026-11-03T18-06-46-{CODEX}.jsonl"
    ))
}

/// A Claude session in a worktree, its subagent, a Codex session, a guardian, a thread name.
fn write_home(home: &Path) {
    let cwd = format!("{}/work/desk/.claude/worktrees/icons", home.display());
    let at = |t: &str| format!("2026-11-04T08:{t}:00Z");
    let token = format!("gh{}_{}", "p", "x7".repeat(18));
    lines(
        &claude_main(home),
        &[
            json!({ "type": "user", "timestamp": at("20"), "cwd": cwd, "gitBranch": "ai/9001-icons",
            "message": { "role": "user", "content": format!(
                "<system-reminder>ACME-923 from CLAUDE.md</system-reminder>Add icons for ACME-2001, token {token}") } }),
            json!({ "type": "assistant", "timestamp": at("21"), "cwd": cwd, "message": {
            "model": "claude-opus-5-5", "content": [
                { "type": "text", "text": "Reading the tree as ADR 0088 says." },
                { "type": "tool_use", "id": "t1", "name": "Edit",
                  "input": { "file_path": format!("{cwd}/plugins/explorer/ui/tree.js") } },
                { "type": "tool_use", "id": "t2", "name": "mcp__ccd_turn__wrap_up", "input": {} } ] } }),
            json!({ "type": "user", "timestamp": at("22"), "cwd": cwd, "message": { "role": "user",
            "content": [{ "type": "tool_result", "tool_use_id": "t1", "content": "ACME-404" }] } }),
            json!({ "type": "user", "isMeta": true, "timestamp": at("23"), "cwd": cwd,
            "message": { "role": "user", "content": "ACME-405 caveat" } }),
            json!({ "type": "pr-link", "prNumber": 9001, "timestamp": at("30"),
            "prUrl": "https://github.com/example/desk/pull/9001", "prRepository": "example/desk" }),
            json!({ "type": "custom-title", "customTitle": "Explorer icons" }),
        ],
    );
    lines(
        &home.join(format!(
            ".claude/projects/-work-desk/{MAIN}/subagents/agent-a1.jsonl"
        )),
        &[
            json!({ "type": "user", "isSidechain": true, "timestamp": at("24"), "cwd": cwd,
            "message": { "role": "user", "content": "Check the icon set" } }),
            json!({ "type": "assistant", "timestamp": at("25"), "cwd": cwd, "message": { "content": [
            { "type": "tool_use", "id": "t3", "name": "Read",
              "input": { "file_path": format!("{cwd}/plugins/explorer/ui/tree.js") } } ] } }),
        ],
    );
    let work = format!("{}/work/desk", home.display());
    lines(
        &codex_file(home),
        &[
            json!({ "timestamp": "2026-11-03T09:06:46Z", "type": "session_meta", "payload": {
            "id": CODEX, "cwd": work, "git": { "branch": "main" }, "source": "vscode" } }),
            json!({ "timestamp": "2026-11-03T09:06:47Z", "type": "response_item", "payload": {
            "type": "message", "role": "user", "content": [{ "type": "input_text",
            "text": "# AGENTS.md instructions for /work\n\n<INSTRUCTIONS>ACME-1</INSTRUCTIONS>" }] } }),
            json!({ "timestamp": "2026-11-03T09:07:00Z", "type": "response_item", "payload": {
            "type": "message", "role": "user", "content": [{ "type": "input_text",
            "text": "Fix the explorer too, see ACME-2001" }] } }),
            json!({ "timestamp": "2026-11-03T09:08:00Z", "type": "response_item", "payload": {
            "type": "custom_tool_call", "name": "exec", "input":
            "await tools.exec_command({cmd: `apply_patch <<'EOF'\n*** Update File: plugins/explorer/ui/tree.js\nEOF`})" } }),
            json!({ "timestamp": "2026-11-03T09:09:00Z", "type": "response_item", "payload": {
            "type": "function_call_output", "output": "ACME-406" } }),
            json!({ "timestamp": "2026-11-03T09:40:00Z", "type": "response_item", "payload": {
            "type": "message", "role": "assistant", "content": [{ "type": "output_text", "text": "Done." }] } }),
        ],
    );
    lines(
        &home.join(".codex/sessions/2026/11/03/rollout-2026-11-03T18-07-00-guardian.jsonl"),
        &[
            json!({ "type": "session_meta", "payload": { "id": "g1", "source": { "subagent": { "other": "guardian" } } } }),
            json!({ "type": "response_item", "payload": { "type": "message", "role": "user",
            "content": [{ "type": "input_text", "text": "Assess the planned action" }] } }),
        ],
    );
    lines(
        &home.join(".codex/session_index.jsonl"),
        &[json!({ "id": CODEX, "thread_name": "Updater channel" })],
    );
}

fn records(items: &[Item]) -> Vec<(String, String, AgentSessionFields, String)> {
    let mut out: Vec<_> = items
        .iter()
        .map(|item| {
            let Item::Record(r) = item else {
                panic!("not a record: {item:?}")
            };
            let fields = serde_json::from_value(Value::Object(r.fields.clone())).unwrap();
            (
                r.id.clone(),
                r.title.clone(),
                fields,
                r.body.clone().unwrap_or_default(),
            )
        })
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

fn has(fields: &AgentSessionFields, kind: AgentLinkKind, key: &str, rel: AgentLinkRel) -> bool {
    fields
        .links
        .iter()
        .any(|l| l.kind == kind && l.key == key && l.rel == rel)
}

fn keys(fields: &AgentSessionFields) -> Vec<&str> {
    fields.links.iter().map(|l| l.key.as_str()).collect()
}

#[test]
fn transcripts_become_session_items_with_their_links() {
    let home = home("links");
    write_home(&home);
    let mut seen = Seen::fresh();
    let changes = sync(&roots(&home), &mut seen);
    let found = records(&changes.upserted);
    let ids: Vec<&str> = found.iter().map(|f| f.0.as_str()).collect();
    assert_eq!(
        ids,
        [
            format!("claude:{MAIN}").as_str(),
            "claude:agent-a1",
            &format!("codex:{CODEX}")
        ]
    );

    let (_, title, main, body) = &found[0];
    assert_eq!(title, "Explorer icons");
    assert_eq!(main.repo.as_deref(), Some("~/work/desk"));
    assert_eq!(main.turns, 1);
    assert_eq!(main.mcp.as_deref(), Some(&["ccd_turn".to_owned()][..]));
    let tree = "~/work/desk/plugins/explorer/ui/tree.js";
    assert!(has(main, AgentLinkKind::File, tree, AgentLinkRel::Edited));
    assert!(has(
        main,
        AgentLinkKind::Pr,
        "github.com/example/desk#9001",
        AgentLinkRel::Opened
    ));
    assert!(has(
        main,
        AgentLinkKind::Adr,
        "ADR-0088@~/work/desk",
        AgentLinkRel::Cites
    ));
    assert!(has(
        main,
        AgentLinkKind::Branch,
        "~/work/desk@ai/9001-icons",
        AgentLinkRel::On
    ));
    let ticket = main.links.iter().find(|l| l.key == "ACME-2001").unwrap();
    assert_eq!(ticket.r#where, Some(AgentLinkPlace::Prompt));
    for noise in ["ACME-923", "ACME-404", "ACME-405"] {
        assert!(
            !keys(main).contains(&noise),
            "{noise} came from injected text or tool output"
        );
    }
    assert!(
        body.contains(MASK) && !body.contains("x7x7x7"),
        "the token is masked: {body}"
    );

    let (_, _, sub, _) = &found[1];
    assert_eq!(
        (sub.subagent, sub.parent.as_deref()),
        (true, Some(format!("claude:{MAIN}").as_str()))
    );
    assert!(has(sub, AgentLinkKind::File, tree, AgentLinkRel::Read));

    let (_, title, codex, _) = &found[2];
    assert_eq!(title, "Updater channel");
    assert_eq!(codex.turns, 1);
    assert!(has(codex, AgentLinkKind::File, tree, AgentLinkRel::Edited));
    assert!(!keys(codex).contains(&"ACME-1") && !keys(codex).contains(&"ACME-406"));
}

#[test]
fn a_second_sync_reads_only_what_changed() {
    let home = home("incremental");
    write_home(&home);
    let roots = roots(&home);
    let mut seen = Seen::fresh();
    assert_eq!(sync(&roots, &mut seen).upserted.len(), 3);
    assert!(sync(&roots, &mut seen).upserted.is_empty());

    let mut text = fs::read_to_string(claude_main(&home)).unwrap();
    text.push_str(&format!(
        "{}\n",
        json!({ "type": "user", "timestamp": "2026-11-04T10:00:00Z",
        "message": { "role": "user", "content": "One more thing" } })
    ));
    fs::write(claude_main(&home), text).unwrap();
    lines(
        &home.join(".codex/session_index.jsonl"),
        &[json!({ "id": CODEX, "thread_name": "Renamed" })],
    );
    let changes = sync(&roots, &mut seen);
    let found = records(&changes.upserted);
    assert_eq!(found.len(), 2);
    assert_eq!(found[0].2.turns, 2);
    assert_eq!(found[1].1, "Renamed");

    fs::remove_file(codex_file(&home)).unwrap();
    let changes = sync(&roots, &mut seen);
    assert_eq!(changes.removed, [format!("codex:{CODEX}")]);
    let path = home.join("seen.json");
    seen.save(&path).unwrap();
    assert_eq!(Seen::load(&path), seen);
}

#[test]
fn compressed_codex_sessions_are_read_too() {
    let home = home("zstd");
    let old = "33333333-3333-4333-8333-333333333333";
    let text: String = [
        json!({ "timestamp": "2026-10-02T09:00:00Z", "type": "session_meta",
            "payload": { "id": old, "cwd": format!("{}/work/desk", home.display()) } }),
        json!({ "timestamp": "2026-10-02T09:01:00Z", "type": "response_item", "payload": {
            "type": "message", "role": "user",
            "content": [{ "type": "input_text", "text": "Old work on ACME-77" }] } }),
    ]
    .iter()
    .map(|r| format!("{r}\n"))
    .collect();
    let packed = ruzstd::encoding::compress_to_vec(
        text.as_bytes(),
        ruzstd::encoding::CompressionLevel::Fastest,
    );
    let dir = home.join(".codex/archived_sessions");
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join(format!("rollout-2026-10-02T09-00-00-{old}.jsonl.zst")),
        packed,
    )
    .unwrap();
    let changes = sync(&roots(&home), &mut Seen::fresh());
    let found = records(&changes.upserted);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].0, format!("codex:{old}"));
    assert!(found[0].2.links.iter().any(|l| l.key == "ACME-77"));
}
