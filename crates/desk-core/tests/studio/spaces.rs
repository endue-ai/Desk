//! studio.spaces.* (ADR 0129): the spaces the person can open, most recently active first; one
//! space's overview and rooms in the bridge's shapes, a part endue AI did not answer named in
//! problems; and nothing the bridge does not name crossing it (members, people's ids, pictures,
//! colours that are not #rrggbb).

use desk_bridge::{StudioSpacesGetResult, StudioSpacesListResult};
use desk_platform::fake::FakeSpace;

use super::*;

fn seed(fake: &FakePlatform) {
    let mut launch = FakeSpace::new("sp_launch", "Launch");
    launch.body["goal"] = json!("Ship the launch page");
    launch.body["front_agent_id"] = json!("ag_front");
    launch.body["avatar_color"] = json!("#B6A3F5");
    launch.body["avatar_glyph"] = json!("🚀");
    launch.body["avatar_url"] = json!("https://images.example/launch.png");
    launch.body["summary"] = json!({
        "active_work_items": 2, "open_attention_items": 1,
        "latest_result": { "id": "res_1", "title": "Launch page draft", "updated_at": "2026-11-02T09:00:00Z" },
        "last_activity_at": "2026-11-03T09:00:00Z"
    });
    launch.overview = json!({
        "counts": { "active_work_items": 1, "open_attention_items": 1, "results": 3 },
        "agents": [
            { "id": "sa_2", "agent_id": "ag_writer", "role_key": "writer", "is_front": false,
              "status": "active", "unnamed": { "kept": "conn_1" } },
            { "id": "sa_1", "agent_id": "ag_front", "role_key": "generalist", "is_front": true,
              "permission": "admin", "status": "active" },
            { "id": "sa_3", "agent_id": "ag_gone", "role_key": "analyst", "is_front": false,
              "permission": "participant", "status": "removed" }
        ],
        "active_work_items": [
            { "id": "wi_1", "title": "Write the first mail", "display_status": "in_progress",
              "updated_at": "2026-11-03T09:00:00Z" },
            { "id": "wi_2", "title": "A status from later", "display_status": "dreaming",
              "updated_at": "2026-11-03T09:00:00Z" }
        ],
        "recent_results": [
            { "id": "res_1", "title": "Launch page draft", "kind": "document",
              "updated_at": "2026-11-02T09:00:00Z" }
        ],
        "attention_items": [{ "id": "att_1", "reason": "some_reason", "detail": { "kept": "away" } }]
    });
    launch.rooms = vec![
        json!({ "id": "room_1", "name": "Copy", "topic": "The launch mail", "status": "active",
                "unread_count": 3, "last_message_at": "2026-11-03T09:00:00Z",
                "active_discussion": { "id": "d_1" },
                "threads": { "active": 1, "needs_you": 1, "unread": 2 },
                "members": [{ "subject_id": "u_person", "display_name": "Someone" }] }),
        json!({ "id": "room_2", "name": "Old", "status": "archived", "unread_count": 0 }),
    ];
    let mut quiet = FakeSpace::new("sp_quiet", "Quiet");
    quiet.body["avatar_color"] = json!("red; background: url(x)");
    quiet.body["updated_at"] = json!("2026-11-01T10:00:00Z");
    let mut gone = FakeSpace::new("sp_gone", "Gone");
    gone.body["status"] = json!("deleted");
    let mut put_away = FakeSpace::new("sp_away", "Away");
    put_away.body["status"] = json!("archived");
    fake.state().spaces = vec![quiet, launch, gone, put_away];
}

#[test]
fn spaces_list_most_recently_active_first_with_only_named_fields() {
    let fake = FakePlatform::start();
    seed(&fake);
    let core = desk("studio-spaces-list", &fake);
    let listed = studio(&core, "studio.spaces.list", json!({})).unwrap();
    let typed: StudioSpacesListResult = serde_json::from_value(listed.clone()).unwrap();
    let ids: Vec<&str> = typed.spaces.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(
        ids,
        ["sp_launch", "sp_quiet"],
        "deleted and archived ones stay out"
    );
    let launch = &listed["spaces"][0];
    assert_eq!(launch["goal"], "Ship the launch page");
    assert_eq!(launch["frontAgentId"], "ag_front");
    assert_eq!(launch["avatarColor"], "#B6A3F5");
    assert_eq!(launch["avatarGlyph"], "🚀");
    assert_eq!(
        launch["summary"]["latestResult"]["title"],
        "Launch page draft"
    );
    assert!(launch.get("avatarUrl").is_none(), "no remote picture");
    assert!(launch.get("unnamed").is_none() && launch.get("revision").is_none());
    assert!(
        listed["spaces"][1].get("avatarColor").is_none(),
        "not #rrggbb: dropped"
    );
    let seen = fake.seen_at("GET", "/api/v1/spaces");
    assert_eq!(
        seen[0].query.get("include").map(String::as_str),
        Some("summary")
    );

    let archived = studio(&core, "studio.spaces.list", json!({ "archived": true })).unwrap();
    assert_eq!(archived["spaces"][0]["id"], "sp_away");
    assert_eq!(archived["spaces"].as_array().unwrap().len(), 1);
}

#[test]
fn one_space_reads_its_overview_and_rooms_without_members() {
    let fake = FakePlatform::start();
    seed(&fake);
    let core = desk("studio-spaces-get", &fake);
    let got = studio(
        &core,
        "studio.spaces.get",
        json!({ "spaceId": "sp_launch" }),
    )
    .unwrap();
    let typed: StudioSpacesGetResult = serde_json::from_value(got.clone()).unwrap();
    assert_eq!(typed.space.name, "Launch");
    assert_eq!(
        got["counts"],
        json!({ "activeWorkItems": 1, "openAttentionItems": 1, "results": 3 })
    );
    assert_eq!(
        got["agents"],
        json!([
            { "agentId": "ag_front", "roleKey": "generalist", "front": true, "permission": "admin" },
            { "agentId": "ag_writer", "roleKey": "writer", "front": false, "permission": "participant" }
        ]),
        "the front agent first; one that left is not listed"
    );
    assert_eq!(
        got["work"].as_array().unwrap().len(),
        1,
        "an unknown status stays out"
    );
    assert_eq!(got["work"][0]["status"], "in_progress");
    assert_eq!(got["results"][0]["kind"], "document");
    assert_eq!(
        got["rooms"],
        json!([{ "id": "room_1", "name": "Copy", "topic": "The launch mail", "unreadCount": 3,
                 "lastMessageAt": "2026-11-03T09:00:00Z", "discussing": true,
                 "threads": { "active": 1, "needsYou": 1, "unread": 2 } }])
    );
    assert_eq!(got["problems"], json!([]));
    let text = got.to_string();
    for kept_away in [
        "u_person",
        "Someone",
        "some_reason",
        "conn_1",
        "images.example",
    ] {
        assert!(!text.contains(kept_away), "{kept_away} crossed the bridge");
    }
}

#[test]
fn a_part_that_does_not_answer_is_a_problem_and_a_missing_space_is_not_found() {
    let fake = FakePlatform::start();
    seed(&fake);
    let core = desk("studio-spaces-parts", &fake);
    fake.state().fail_at(
        "/api/v1/spaces/sp_launch/rooms",
        503,
        "UNAVAILABLE",
        "rooms are down",
    );
    let got = studio(
        &core,
        "studio.spaces.get",
        json!({ "spaceId": "sp_launch" }),
    )
    .unwrap();
    assert_eq!(got["rooms"], json!([]));
    assert_eq!(
        got["problems"],
        json!([{ "part": "rooms", "code": "io_error", "message": "rooms are down" }])
    );
    assert_eq!(got["counts"]["results"], 3, "the overview still answered");

    let get = |id: &str| studio(&core, "studio.spaces.get", json!({ "spaceId": id }));
    assert_eq!(get("sp_nowhere").unwrap_err().code, ErrorCode::NotFound);
    assert_eq!(get("sp_gone").unwrap_err().code, ErrorCode::NotFound);
    fake.state()
        .fail_next(403, "FORBIDDEN", "Region not available");
    assert_eq!(get("sp_launch").unwrap_err().code, ErrorCode::Forbidden);
}
