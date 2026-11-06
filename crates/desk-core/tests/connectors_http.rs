//! The http connector binding (ADR 0106) over desk.github (plugins/github): its three searches against
//! a fixture GitHub on 127.0.0.1, the token read from the secrets file by the core alone and sent only
//! there, pages followed, records mapped into task items, a second sync dropping what left, disconnect,
//! the net:fetch grant and a restart. Syncs run on an explicit tick and a fake clock; nothing here
//! touches the network.

mod github;
mod layer;

use desk_bridge::ErrorCode;
use github::{Server, plugin_copy, serve};
use layer::fixtures::{by_id, state};
use layer::{Desk, connector_manage, ids, source};
use serde_json::{Value, json};

const GITHUB: &str = "desk.github";
const TOKEN: &str = "ghp_fixtureToken0123456789abcdef";

/// A desk with the copy of plugins/github installed as a built-in (its net:fetch grant from the
/// manifest), and the fixture GitHub it reads.
fn github_desk(tag: &str) -> (Desk, Server) {
    let server = serve(TOKEN);
    let desk = Desk::new(tag, None);
    let dir = plugin_copy(&desk.home.join("plugins"), &server, |_| {});
    desk.core.install_plugin(&dir, true);
    (desk, server)
}

fn connect(desk: &Desk) -> Value {
    let settings = json!({ "token": TOKEN });
    let params =
        json!({ "connector": GITHUB, "instance": "work", "title": "Work", "settings": settings });
    desk.connect(params).unwrap()
}

fn work(desk: &Desk) -> Vec<Value> {
    let query = json!({ "kinds": ["task"], "sources": [format!("{GITHUB}/work")], "limit": 100 });
    let mut items = desk.items(query);
    items.sort_by_key(|i| i["id"].as_str().unwrap().to_owned());
    items
}

fn sync_now(desk: &Desk, connector: &str) {
    let params = json!({ "connector": connector, "instance": "work", "scope": connector_manage() });
    desk.ok("desk", "connector.sync", params);
}

const ALL: [&str; 5] = [
    "I_kwDOFixture012",
    "I_kwDOFixture015",
    "I_kwDOFixtureW03",
    "PR_kwDOFixture018",
    "PR_kwDOFixture021",
];

#[test]
fn the_github_connector_brings_assigned_review_and_own_work_as_tasks() {
    let (desk, server) = github_desk("http-github");
    assert_eq!(connect(&desk), json!({ "instance": "work" }));
    desk.tick();

    let items = work(&desk);
    assert_eq!(ids(&items), ALL, "one item per issue or pull request");
    let calendar = by_id(&items, "I_kwDOFixture012");
    assert_eq!(calendar["kind"], "task");
    assert_eq!(calendar["source"], source(GITHUB, "work"));
    assert_eq!(calendar["title"], "Calendar drops all-day events");
    assert_eq!(calendar["status"], "open");
    assert_eq!(calendar["project"], "acme/garage");
    assert_eq!(
        calendar["due"], "2026-10-30T07:00:00Z",
        "the milestone's due date"
    );
    assert_eq!(
        calendar["deepLink"],
        "https://github.com/acme/garage/issues/12"
    );
    assert_eq!(calendar["updatedAt"], "2026-10-29T08:30:00Z");
    assert_eq!(calendar["createdAt"], "2026-10-20T01:00:00Z");
    assert_eq!(
        calendar["body"],
        "All-day events vanish from the agenda after a sync."
    );
    assert_eq!(calendar["raw"]["number"], 12);
    assert_eq!(calendar["raw"]["labels"][0]["name"], "bug");
    assert!(calendar.get("completedAt").is_none(), "closed_at is null");
    let notes = by_id(&items, "I_kwDOFixture015");
    assert!(notes.get("due").is_none(), "a milestone without a due date");
    assert_eq!(
        by_id(&items, "I_kwDOFixtureW03")["project"],
        "acme/workshop"
    );
    let review = by_id(&items, "PR_kwDOFixture018");
    assert_eq!(review["deepLink"], "https://github.com/acme/garage/pull/18");
    assert!(review["raw"]["pull_request"].is_object());

    let seen = server.seen();
    assert_eq!(
        seen.len(),
        4,
        "three searches and the assigned search's second page: {seen:?}"
    );
    for request in &seen {
        let header = |name: &str| request.headers.get(name).cloned().unwrap_or_default();
        assert_eq!(header("authorization"), format!("Bearer {TOKEN}"));
        assert_eq!(header("accept"), "application/vnd.github+json");
        assert_eq!(header("x-github-api-version"), "2022-11-28");
        assert!(
            request.target.starts_with("/search/issues?"),
            "{}",
            request.target
        );
    }
    let queries: Vec<String> = seen
        .iter()
        .map(|r| github::decode_query(r.target.split_once('?').unwrap().1)["q"].clone())
        .collect();
    assert_eq!(
        queries,
        [
            "is:open assignee:@me",
            "is:open assignee:@me",
            "is:open is:pr review-requested:@me",
            "is:open is:pr author:@me",
        ]
    );
    assert!(
        seen[1].target.ends_with("&page=2"),
        "the Link header's next page"
    );

    let listed = desk.instances(GITHUB);
    assert_eq!(listed.len(), 1);
    assert_eq!(state(&listed[0]), "connected");
    assert_eq!(listed[0]["title"], "Work");
    assert!(listed[0]["status"]["lastSyncAt"].is_string());
}

#[test]
fn the_token_never_crosses_the_bridge() {
    let (desk, server) = github_desk("http-token");
    connect(&desk);
    desk.tick();
    let connectors = desk.connectors();
    let github = connectors.iter().find(|c| c["id"] == GITHUB).unwrap();
    assert_eq!(github["title"], "GitHub");
    assert_eq!(github["auth"]["kind"], "token");
    assert_eq!(github["instanceSettings"]["token"]["secret"], true);
    assert_eq!(github["instances"][0]["settings"], json!({}));
    let mut said = serde_json::to_string(&connectors).unwrap();
    said.push_str(&serde_json::to_string(&work(&desk)).unwrap());
    for (_, event) in desk.drain() {
        said.push_str(&event.to_string());
    }
    assert!(!said.contains(TOKEN), "the token crossed the bridge");
    let kept = std::fs::read_to_string(desk.data.join("secrets.json")).unwrap();
    let kept: Value = serde_json::from_str(&kept).unwrap();
    assert_eq!(kept["secrets"][format!("{GITHUB}/work")]["token"], TOKEN);

    server.fail_with(401);
    sync_now(&desk, GITHUB);
    let listed = desk.instances(GITHUB);
    assert_eq!(state(&listed[0]), "error");
    let error = &listed[0]["status"]["error"];
    assert_eq!(error["reauth"], true, "{error}");
    let message = error["message"].as_str().unwrap();
    assert!(message.contains("401"), "{message}");
    assert!(!message.contains(TOKEN), "{message}");
    assert_eq!(
        work(&desk).len(),
        5,
        "a failed sync keeps what the last one brought"
    );
}

#[test]
fn a_sync_drops_work_that_left_the_results_and_disconnect_drops_the_rest() {
    let (desk, server) = github_desk("http-drop");
    connect(&desk);
    desk.tick();
    assert_eq!(work(&desk).len(), 5);

    server.drop_record("I_kwDOFixture015");
    desk.clock.advance(900);
    desk.tick();
    let left = work(&desk);
    assert_eq!(ids(&left), [ALL[0], ALL[2], ALL[3], ALL[4]]);

    let params = json!({ "connector": GITHUB, "instance": "work", "scope": connector_manage() });
    desk.ok("desk", "connector.disconnect", params);
    assert!(work(&desk).is_empty());
    assert!(desk.instances(GITHUB).is_empty());
    let kept = std::fs::read_to_string(desk.data.join("secrets.json")).unwrap();
    assert!(!kept.contains(TOKEN), "the secret goes with the instance");
}

#[test]
fn an_http_connector_needs_net_fetch_for_its_host() {
    let server = serve(TOKEN);
    let desk = Desk::new("http-grant", None);
    let dir = plugin_copy(&desk.home.join("plugins"), &server, |m| {
        m["id"] = json!("example.tracker");
        m.as_object_mut().unwrap().remove("contributes");
    });
    desk.core.install_plugin(&dir, false);
    let settings = json!({ "token": TOKEN });
    desk.connect(
        json!({ "connector": "example.tracker", "instance": "work", "settings": settings }),
    )
    .unwrap();
    desk.tick();
    let listed = desk.instances("example.tracker");
    assert_eq!(state(&listed[0]), "error");
    let message = listed[0]["status"]["error"]["message"].as_str().unwrap();
    assert!(message.contains("net:fetch"), "{message}");
    assert!(server.seen().is_empty(), "nothing reached the server");

    let host = format!("127.0.0.1:{}", server.port);
    desk.grant(
        "example.tracker",
        json!({ "permission": "net:fetch", "hosts": [host] }),
    );
    sync_now(&desk, "example.tracker");
    assert_eq!(state(&desk.instances("example.tracker")[0]), "connected");
    let query = json!({ "kinds": ["task"], "sources": ["example.tracker/work"], "limit": 100 });
    assert_eq!(desk.items(query).len(), 5);
}

#[test]
fn connect_checks_the_settings_and_an_unknown_instance() {
    let (desk, _server) = github_desk("http-checks");
    let code = |params: Value| desk.connect(params).unwrap_err().code;
    let without = json!({ "connector": GITHUB, "instance": "work" });
    assert_eq!(
        code(without),
        ErrorCode::InvalidParams,
        "the token is required"
    );
    let wrong = json!({ "connector": GITHUB, "settings": { "token": TOKEN, "colour": "red" } });
    assert_eq!(code(wrong), ErrorCode::InvalidParams);
    connect(&desk);
    let again = json!({ "connector": GITHUB, "instance": "work", "settings": { "token": TOKEN } });
    assert_eq!(code(again), ErrorCode::AlreadyExists);
    let params = json!({ "connector": GITHUB, "instance": "home", "scope": connector_manage() });
    desk.fails("desk", "connector.sync", params, ErrorCode::NotFound);
}

#[test]
fn instances_come_back_after_a_restart() {
    let (desk, server) = github_desk("http-restart");
    connect(&desk);
    desk.tick();
    let desk = desk.restart(None);
    let dir = plugin_copy(&desk.home.join("plugins"), &server, |_| {});
    desk.core.install_plugin(&dir, true);
    let listed = desk.instances(GITHUB);
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0]["title"], "Work");
    assert!(listed[0]["status"]["lastSyncAt"].is_string());
    assert_eq!(work(&desk).len(), 5, "the index kept the items");

    server.drop_record("PR_kwDOFixture021");
    desk.tick();
    assert_eq!(
        work(&desk).len(),
        4,
        "the token came back from the secrets file"
    );
}
