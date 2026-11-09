//! The spaces client against the in-process fake platform: the list asks for summaries and the
//! archived ones only when told, one space reads bare, the overview and the rooms come out of their
//! envelopes, a space the person may not open is not_found, and every call carries the bearer token
//! and no Origin. Nothing leaves 127.0.0.1.

use std::sync::Arc;

use desk_platform::fake::{FakePlatform, FakeSpace};
use desk_platform::{ErrorKind, Platform, Tokens};
use serde_json::json;

struct Token;

impl Tokens for Token {
    fn token(&self) -> Option<String> {
        Some("token-1".to_owned())
    }

    fn refresh(&self, _rejected: &str) -> Option<String> {
        None
    }
}

fn client(fake: &FakePlatform) -> Platform {
    Platform::new(fake.url(), Arc::new(Token)).unwrap()
}

fn seeded() -> FakePlatform {
    let fake = FakePlatform::start();
    let mut launch = FakeSpace::new("sp_launch", "Launch");
    launch.body["goal"] = json!("Ship the launch page");
    launch.body["avatar_color"] = json!("#B6A3F5");
    launch.body["summary"] = json!({
        "active_work_items": 2, "open_attention_items": 1,
        "latest_result": { "id": "res_1", "title": "Launch page draft", "updated_at": "2026-11-02T09:00:00Z" },
        "last_activity_at": "2026-11-02T09:00:00Z"
    });
    launch.overview["counts"] =
        json!({ "active_work_items": 1, "open_attention_items": 1, "results": 3 });
    launch.overview["agents"] = json!([
        { "id": "sa_1", "agent_id": "ag_1", "role_key": "generalist", "is_front": true,
          "permission": "admin", "status": "active", "unnamed": {} }
    ]);
    launch.rooms = vec![json!({
        "id": "room_1", "name": "Copy", "status": "active", "unread_count": 2,
        "members": [{ "subject_id": "u_someone" }], "active_discussion": { "id": "d_1" }
    })];
    let mut old = FakeSpace::new("sp_old", "Old");
    old.body["status"] = json!("archived");
    let mut theirs = FakeSpace::new("sp_theirs", "Theirs");
    theirs.foreign = true;
    fake.state().spaces = vec![launch, old, theirs];
    fake
}

#[test]
fn the_list_asks_for_summaries_and_keeps_archived_ones_apart() {
    let fake = seeded();
    let platform = client(&fake);
    let active = platform.spaces(false).unwrap();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].id, "sp_launch");
    assert_eq!(active[0].goal.as_deref(), Some("Ship the launch page"));
    let summary = active[0].summary.as_ref().unwrap();
    assert_eq!(
        (summary.active_work_items, summary.open_attention_items),
        (2, 1)
    );
    assert_eq!(
        summary.latest_result.as_ref().unwrap().title,
        "Launch page draft"
    );
    let archived = platform.spaces(true).unwrap();
    assert_eq!(
        archived.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
        ["sp_old"]
    );

    let seen = fake.seen_at("GET", "/api/v1/spaces");
    assert_eq!(
        seen[0].query.get("include").map(String::as_str),
        Some("summary")
    );
    assert_eq!(seen[0].query.get("status"), None);
    assert_eq!(
        seen[1].query.get("status").map(String::as_str),
        Some("archived")
    );
    for request in &seen {
        assert_eq!(
            request.headers.get("authorization").map(String::as_str),
            Some("Bearer token-1")
        );
        assert!(!request.headers.contains_key("origin"));
    }
}

#[test]
fn one_space_its_overview_and_its_rooms_read_through_their_envelopes() {
    let fake = seeded();
    let platform = client(&fake);
    let space = platform.space("sp_launch").unwrap();
    assert_eq!(space.name, "Launch");
    assert_eq!(space.avatar_color.as_deref(), Some("#B6A3F5"));
    let overview = platform.space_overview("sp_launch").unwrap();
    assert_eq!(overview.counts.results, 3);
    assert_eq!(overview.agents[0].agent_id, "ag_1");
    assert!(overview.agents[0].is_front);
    let rooms = platform.space_rooms("sp_launch").unwrap();
    assert_eq!(rooms.len(), 1);
    assert_eq!(rooms[0].unread_count, 2);
    assert!(rooms[0].active_discussion.is_some());
}

#[test]
fn a_space_the_person_may_not_open_is_not_found() {
    let fake = seeded();
    let platform = client(&fake);
    let error = platform.space("sp_theirs").unwrap_err();
    assert_eq!(error.kind, ErrorKind::NotFound);
    assert_eq!(
        platform.space_rooms("sp_nowhere").unwrap_err().kind,
        ErrorKind::NotFound
    );
}

#[test]
fn a_space_id_is_one_path_segment() {
    let fake = seeded();
    let platform = client(&fake);
    let error = platform.space("../agents").unwrap_err();
    assert_eq!(error.kind, ErrorKind::NotFound);
    assert!(fake.seen_at("GET", "/api/v1/agents").is_empty());
}
