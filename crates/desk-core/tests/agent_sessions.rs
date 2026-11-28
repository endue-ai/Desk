//! The built-in connector desk.agent-sessions (ADR 0403) over a made-up home: listed with the
//! record resource, nothing read before connect, the sessions as items after a sync, a grown
//! transcript read again on the next one, a gone one removed, and everything cleared on disconnect.

mod layer;

use std::fs;
use std::path::Path;

use layer::{Desk, connector_manage};
use serde_json::{Value, json};

const MAIN: &str = "11111111-1111-4111-8111-111111111111";
const CODEX: &str = "22222222-2222-4222-8222-222222222222";
const SESSIONS: &str = "desk.agent-sessions";

fn write(path: &Path, records: &[Value]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let text: String = records.iter().map(|r| format!("{r}\n")).collect();
    fs::write(path, text).unwrap();
}

fn claude(home: &Path) -> std::path::PathBuf {
    home.join(format!(".claude/projects/-work-desk/{MAIN}.jsonl"))
}

fn codex(home: &Path) -> std::path::PathBuf {
    home.join(format!(
        ".codex/sessions/2026/11/03/rollout-2026-11-03T18-06-46-{CODEX}.jsonl"
    ))
}

fn transcripts(home: &Path) {
    let cwd = format!("{}/work/desk", home.display());
    write(
        &claude(home),
        &[
            json!({ "type": "user", "timestamp": "2026-11-04T08:20:00Z", "cwd": cwd,
            "message": { "role": "user", "content": "Add icons for ACME-2001" } }),
            json!({ "type": "assistant", "timestamp": "2026-11-04T08:21:00Z", "message": { "content": [
            { "type": "tool_use", "id": "t1", "name": "Edit",
              "input": { "file_path": format!("{cwd}/plugins/explorer/ui/tree.js") } } ] } }),
        ],
    );
    write(
        &codex(home),
        &[
            json!({ "timestamp": "2026-11-03T09:06:46Z", "type": "session_meta",
            "payload": { "id": CODEX, "cwd": cwd } }),
            json!({ "timestamp": "2026-11-03T09:07:00Z", "type": "response_item", "payload": {
            "type": "message", "role": "user",
            "content": [{ "type": "input_text", "text": "Review ACME-2001" }] } }),
        ],
    );
}

fn sessions(desk: &Desk) -> Vec<Value> {
    let mut items = desk.items(json!({ "kinds": ["record"], "sources": [SESSIONS] }));
    items.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    items
}

#[test]
fn desk_agent_sessions_is_listed_and_reads_nothing_before_connect() {
    let desk = Desk::with_sessions("sessions-list");
    transcripts(&desk.home);
    let listed = desk.connectors();
    let found = listed.iter().find(|c| c["id"] == SESSIONS).expect("listed");
    assert_eq!(found["resources"], json!([{ "kind": "record" }]));
    assert_eq!(found["instances"], json!([]));
    desk.tick();
    assert!(sessions(&desk).is_empty());
}

#[test]
fn connecting_brings_sessions_in_and_syncs_keep_them_current() {
    let desk = Desk::with_sessions("sessions-sync");
    transcripts(&desk.home);
    let answer = desk.connect(json!({ "connector": SESSIONS })).unwrap();
    assert_eq!(answer, json!({ "instance": "default" }));
    desk.tick();
    let items = sessions(&desk);
    let ids: Vec<&str> = items.iter().filter_map(|i| i["id"].as_str()).collect();
    assert_eq!(ids, [format!("claude:{MAIN}"), format!("codex:{CODEX}")]);
    let main = &items[0];
    assert_eq!(
        main["schema"],
        "https://endue.ai/specs/item/v0/agent-session.schema.json"
    );
    assert_eq!(main["fields"]["repo"], "~/work/desk");
    assert_eq!(main["fields"]["turns"], 1);
    let file = json!({ "kind": "file", "key": "~/work/desk/plugins/explorer/ui/tree.js",
        "rel": "edited", "count": 1 });
    assert!(main["fields"]["links"].as_array().unwrap().contains(&file));
    let state = desk.instances(SESSIONS)[0]["status"]["state"].clone();
    assert_eq!(state, "connected");

    let mut text = fs::read_to_string(claude(&desk.home)).unwrap();
    text.push_str(&format!(
        "{}\n",
        json!({ "type": "user", "timestamp": "2026-11-04T09:00:00Z",
        "message": { "role": "user", "content": "And the docs" } })
    ));
    fs::write(claude(&desk.home), text).unwrap();
    fs::remove_file(codex(&desk.home)).unwrap();
    desk.tick();
    assert_eq!(sessions(&desk).len(), 2, "not due before the interval");
    desk.clock.advance(300);
    desk.tick();
    let items = sessions(&desk);
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["fields"]["turns"], 2);
}

#[test]
fn disconnecting_clears_the_items_and_what_was_read() {
    let desk = Desk::with_sessions("sessions-disconnect");
    transcripts(&desk.home);
    desk.connect(json!({ "connector": SESSIONS })).unwrap();
    desk.tick();
    assert_eq!(sessions(&desk).len(), 2);
    assert!(desk.data.join("agent-sessions.json").exists());
    let params =
        json!({ "connector": SESSIONS, "instance": "default", "scope": connector_manage() });
    desk.ok("desk", "connector.disconnect", params);
    assert!(sessions(&desk).is_empty());
    assert!(!desk.data.join("agent-sessions.json").exists());

    // Connecting again reads everything again, though nothing changed on disk.
    desk.connect(json!({ "connector": SESSIONS })).unwrap();
    desk.tick();
    assert_eq!(sessions(&desk).len(), 2);
}
