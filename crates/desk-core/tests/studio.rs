//! studio.* (ADR 0122): the person's endue AI agents through endue AI's platform API, against the
//! in-process fake platform of desk-platform. Every call needs studio:manage; signed out, out of
//! reach and refused are typed errors; agents go round trip from create to remove; facets, the
//! catalog and the conversations of the Home board answer in the bridge's shapes.

mod support;

#[path = "studio/board.rs"]
mod board;

use std::fs;
use std::sync::Arc;
use std::time::Duration;

use desk_bridge::ErrorCode;
use desk_core::account::{Account, AccountOptions, NetIdClient};
use desk_core::{Core, studio_tokens};
use desk_platform::fake::FakePlatform;
use desk_platform::{Platform, Tokens};
use serde_json::{Value, json};
use support::*;

const AGENTS: &str = "endue.agents";

struct Token(Option<&'static str>);

impl Tokens for Token {
    fn token(&self) -> Option<String> {
        self.0.map(str::to_owned)
    }

    fn refresh(&self, _rejected: &str) -> Option<String> {
        None
    }
}

fn platform(fake: &FakePlatform, token: Option<&'static str>) -> Platform {
    Platform::new(fake.url(), Arc::new(Token(token))).unwrap()
}

/// A core whose studio.* goes to `fake`, with the agents plugin holding studio:manage.
fn desk(tag: &str, fake: &FakePlatform) -> Core {
    let core = Core::new(roots(&home(tag))).with_platform(platform(fake, Some("token-1")));
    grant(&core, AGENTS, json!({ "permission": "studio:manage" }));
    core
}

fn studio(core: &Core, method: &str, mut params: Value) -> Result<Value, desk_bridge::BridgeError> {
    params["scope"] = json!({ "permission": "studio:manage" });
    call(core, AGENTS, method, params)
}

/// Every studio method with params that would do something.
fn every_call(agent: &str) -> Vec<(&'static str, Value)> {
    vec![
        ("studio.agents.list", json!({})),
        ("studio.agents.get", json!({ "agentId": agent })),
        (
            "studio.agents.create",
            json!({ "name": "Miso", "role": "Mail" }),
        ),
        (
            "studio.agents.update",
            json!({ "agentId": agent, "name": "Miso 2" }),
        ),
        (
            "studio.agents.setStatus",
            json!({ "agentId": agent, "status": "inactive" }),
        ),
        ("studio.agents.remove", json!({ "agentId": agent })),
        ("studio.agents.facets", json!({ "agentId": agent })),
        (
            "studio.agents.prompt.update",
            json!({ "agentId": agent, "content": "Be brief." }),
        ),
        ("studio.catalog.list", json!({})),
        (
            "studio.catalog.recommend",
            json!({ "query": "answer my mail" }),
        ),
        ("studio.catalog.use", json!({ "slug": "support-mail" })),
        ("studio.conversations.list", json!({ "agentId": agent })),
    ]
}

#[test]
fn studio_methods_need_studio_manage() {
    let fake = FakePlatform::start();
    let agent = fake.state().add_agent("Miso", "Mail");
    let core =
        Core::new(roots(&home("studio-perm"))).with_platform(platform(&fake, Some("token-1")));
    grant(
        &core,
        "other.plugin",
        json!({ "permission": "agents:manage" }),
    );
    for (method, params) in every_call(&agent) {
        for caller in [AGENTS, "other.plugin"] {
            let mut params = params.clone();
            params["scope"] = json!({ "permission": "studio:manage" });
            let error = call(&core, caller, method, params).unwrap_err();
            assert_eq!(
                error.code,
                ErrorCode::PermissionDenied,
                "{method} for {caller}"
            );
            let missing = serde_json::to_value(error.permission).unwrap();
            assert_eq!(
                missing,
                json!({ "permission": "studio:manage" }),
                "{method}"
            );
        }
    }
    assert!(fake.seen().is_empty(), "nothing reached endue AI");

    grant(&core, AGENTS, json!({ "permission": "studio:manage" }));
    let listed = studio(&core, "studio.agents.list", json!({})).unwrap();
    assert_eq!(listed["agents"][0]["id"], agent);
}

fn account(tag: &str, token: Option<&str>) -> Arc<Account> {
    let dir = home(tag).join("data");
    fs::create_dir_all(&dir).unwrap();
    let file = dir.join("account.json");
    if let Some(token) = token {
        // A session that is far from expiring, so the account hands its token out as it is.
        let saved = json!({ "version": 2, "note": "test", "accessToken": token,
            "refreshCookie": "rt-1", "issuedAt": 1_767_225_300_u64, "expiresAt": 4_102_444_800_u64 });
        fs::write(&file, saved.to_string()).unwrap();
    }
    // endue ID's endpoints are closed here: a renewal finds nothing new.
    let mut options = AccountOptions::new("http://127.0.0.1:9", "http://127.0.0.1:9");
    options.file = Some(file);
    Account::open(options, NetIdClient)
}

#[test]
fn signed_out_is_a_typed_error() {
    let fake = FakePlatform::start();
    let agent = fake.state().add_agent("Miso", "Mail");

    // No endue ID on this desk at all, and one that is signed out: signed_out, nothing sent.
    let bare = Core::new(roots(&home("studio-bare")));
    let out = account("studio-out", None);
    let signed_out = Core::new(roots(&home("studio-out")))
        .with_account(Arc::clone(&out))
        .with_platform(Platform::new(fake.url(), studio_tokens(&out)).unwrap());
    for core in [&bare, &signed_out] {
        grant(core, AGENTS, json!({ "permission": "studio:manage" }));
        for (method, params) in every_call(&agent) {
            let error = studio(core, method, params).unwrap_err();
            assert_eq!(error.code, ErrorCode::SignedOut, "{method}");
            assert!(error.message.contains("Sign in"), "{}", error.message);
        }
    }
    assert!(fake.seen().is_empty());

    // Signed in: the account's token goes out as the bearer.
    let signed_in = account("studio-in", Some("token-1"));
    let core = Core::new(roots(&home("studio-in")))
        .with_account(Arc::clone(&signed_in))
        .with_platform(Platform::new(fake.url(), studio_tokens(&signed_in)).unwrap());
    grant(&core, AGENTS, json!({ "permission": "studio:manage" }));
    let listed = studio(&core, "studio.agents.list", json!({})).unwrap();
    assert_eq!(listed["agents"].as_array().unwrap().len(), 1);
    assert_eq!(fake.seen()[0].headers["authorization"], "Bearer token-1");

    // endue AI no longer takes the token, and renewing the session gives no other: signed_out.
    fake.state().refuse("token-1");
    let error = studio(&core, "studio.agents.list", json!({})).unwrap_err();
    assert_eq!(error.code, ErrorCode::SignedOut);
    assert_eq!(
        fake.seen().len(),
        2,
        "one try with a token the account still holds"
    );
}

#[test]
fn errors_of_endue_ai_are_typed() {
    let fake = FakePlatform::start();
    let core = desk("studio-errors", &fake);
    let theirs = fake.state().add_foreign_agent("Theirs");
    let get = |id: &str| studio(&core, "studio.agents.get", json!({ "agentId": id }));
    assert_eq!(get(&theirs).unwrap_err().code, ErrorCode::Forbidden);
    assert_eq!(get("ag_missing").unwrap_err().code, ErrorCode::NotFound);
    fake.state()
        .fail_next(422, "UNPROCESSABLE", "Invalid status transition");
    let error = get("ag_missing").unwrap_err();
    assert_eq!(
        (error.code, error.message.as_str()),
        (ErrorCode::InvalidParams, "Invalid status transition")
    );
    fake.state().fail_next(503, "UNAVAILABLE", "down");
    assert_eq!(get("ag_missing").unwrap_err().code, ErrorCode::IoError);
    let missing = studio(&core, "studio.catalog.use", json!({ "slug": "no-such" })).unwrap_err();
    assert_eq!(missing.code, ErrorCode::NotFound);

    fake.state().delay = Some(Duration::from_millis(1500));
    let slow = Core::new(roots(&home("studio-slow")))
        .with_platform(platform(&fake, Some("token-1")).with_timeout(Duration::from_millis(300)));
    grant(&slow, AGENTS, json!({ "permission": "studio:manage" }));
    let error = studio(&slow, "studio.agents.list", json!({})).unwrap_err();
    assert_eq!(error.code, ErrorCode::Offline);
    fake.state().delay = None;

    let closed = Core::new(roots(&home("studio-closed")))
        .with_platform(Platform::new("http://127.0.0.1:9", Arc::new(Token(Some("t")))).unwrap());
    grant(&closed, AGENTS, json!({ "permission": "studio:manage" }));
    assert_eq!(
        studio(&closed, "studio.agents.list", json!({}))
            .unwrap_err()
            .code,
        ErrorCode::Offline
    );
}

#[test]
fn list_create_update_remove_round_trip_against_fake_platform() {
    let fake = FakePlatform::start();
    let core = desk("studio-round-trip", &fake);
    assert_eq!(
        studio(&core, "studio.agents.list", json!({})).unwrap(),
        json!({ "agents": [] })
    );

    let params = json!({ "name": "  Miso ", "role": "Keeps my calendar", "languages": ["ko"],
        "model": "anthropic/claude-sonnet-4.5" });
    let created = studio(&core, "studio.agents.create", params).unwrap();
    let agent = created["agent"].clone();
    let id = agent["id"].as_str().unwrap().to_owned();
    assert_eq!(
        (agent["name"].as_str(), agent["slug"].as_str()),
        (Some("Miso"), Some("miso"))
    );
    assert_eq!(agent["status"], "active");
    assert_eq!(created["warnings"], json!([]));
    assert_eq!(
        fake.state().agent(&id).unwrap().model.as_deref(),
        Some("anthropic/claude-sonnet-4.5")
    );
    let listed = studio(&core, "studio.agents.list", json!({})).unwrap();
    assert_eq!(listed["agents"], json!([agent]));

    let update = json!({ "agentId": id, "name": "Miso 2", "role": "Answers mail",
        "description": "Inbox helper", "visibility": "unlisted", "model": "" });
    let updated = studio(&core, "studio.agents.update", update).unwrap();
    assert_eq!(updated["agent"]["name"], "Miso 2");
    assert_eq!(updated["agent"]["slug"], "miso", "the slug never changes");
    let nothing = studio(&core, "studio.agents.update", json!({ "agentId": id })).unwrap_err();
    assert_eq!(nothing.code, ErrorCode::InvalidParams);
    let blank = studio(
        &core,
        "studio.agents.create",
        json!({ "name": " ", "role": "x" }),
    )
    .unwrap_err();
    assert_eq!(blank.code, ErrorCode::InvalidParams);

    let saved = json!({ "agentId": id, "content": "Answer briefly." });
    let first = studio(&core, "studio.agents.prompt.update", saved).unwrap();
    assert_eq!(
        (
            first["prompt"]["rev"].as_u64(),
            first["prompt"]["source"].as_str()
        ),
        (Some(1), Some("manual"))
    );
    let second = json!({ "agentId": id, "content": "Answer in Korean." });
    studio(&core, "studio.agents.prompt.update", second).unwrap();
    let restored = studio(
        &core,
        "studio.agents.prompt.update",
        json!({ "agentId": id, "restore": 1 }),
    )
    .unwrap();
    assert_eq!(
        restored["prompt"],
        json!({ "rev": 3, "content": "Answer briefly.", "source": "restore",
        "restoredFromRev": 1, "createdAt": restored["prompt"]["createdAt"] })
    );

    let facets = studio(&core, "studio.agents.facets", json!({ "agentId": id })).unwrap();
    assert_eq!(facets["identity"]["name"], "Miso 2");
    assert_eq!(facets["identity"]["role"], "Answers mail");
    assert_eq!(facets["identity"]["description"], "Inbox helper");
    assert_eq!(facets["identity"]["languages"], json!(["ko"]));
    assert_eq!(facets["identity"]["personality"]["epistemicHumility"], 0.65);
    assert_eq!(facets["settings"]["visibility"], "unlisted");
    assert_eq!(
        facets["settings"]["model"],
        json!({}),
        "the empty model cleared it"
    );
    assert_eq!(facets["prompt"]["rev"], 3);
    let revs: Vec<(u64, bool)> = facets["revisions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| (r["rev"].as_u64().unwrap(), r["active"].as_bool().unwrap()))
        .collect();
    assert_eq!(revs, [(3, true), (2, false), (1, false)]);
    assert_eq!(facets["problems"], json!([]));

    let off = json!({ "agentId": id, "status": "inactive" });
    assert_eq!(
        studio(&core, "studio.agents.setStatus", off.clone()).unwrap()["agent"]["status"],
        "inactive"
    );
    assert_eq!(
        studio(&core, "studio.agents.setStatus", off).unwrap()["agent"]["status"],
        "inactive"
    );

    let removed = studio(&core, "studio.agents.remove", json!({ "agentId": id })).unwrap();
    assert_eq!(removed, json!({ "agentId": id }));
    assert_eq!(
        studio(&core, "studio.agents.list", json!({})).unwrap(),
        json!({ "agents": [] })
    );
    let again = studio(&core, "studio.agents.remove", json!({ "agentId": id })).unwrap_err();
    assert_eq!(again.code, ErrorCode::NotFound);
}
