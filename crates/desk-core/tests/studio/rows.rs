//! studio.agents.facets reads the rest of what Studio's board shows (ADR 0232): the channels, the
//! API keys made for the agent, its devices and workspaces, what it remembers and made (counted),
//! and its chat's wallpaper. Nothing but what a row shows crosses the bridge.

use super::*;

/// The agent `id`'s answers on the fake, as endue AI gives them.
fn seed_rows(fake: &FakePlatform, id: &str, other: &str) {
    let mut state = fake.state();
    state.answer_at(
        &format!("/api/v1/agents/{id}/channel-pairings"),
        json!({ "pairings": [
            { "id": "cp_1", "agent_id": id, "provider": "slack", "display_name": "Acme",
              "server_name": null, "status": "active", "webhook_url": null,
              "last_active_at": "2026-11-02T08:00:00Z", "created_at": "2026-11-01T09:00:00Z" },
            { "id": "cp_2", "agent_id": id, "provider": "discord", "display_name": null,
              "server_name": "Guild", "status": "pending", "last_active_at": null }
        ], "total": 2 }),
    );
    state.answer_at(
        &format!("/api/v1/agents/{id}/os-devices"),
        json!({ "devices": [
            { "device_id": "dev_1", "station_id": "st_1", "kind": "workspace", "os_kind": "mac",
              "device_type": "actual", "alias": "My Mac", "is_default": true, "workspace_id": null },
            { "device_id": "dev_ws", "station_id": "st_2", "kind": "chrome", "os_kind": "chrome",
              "device_type": "virtual", "alias": "research", "workspace_id": "wsp_1" },
            { "device_id": "dev_2", "kind": "android", "os_kind": "android", "alias": "Pixel" }
        ] }),
    );
    state.answer_at(
        &format!("/api/v1/agents/{id}/workspaces"),
        json!({ "workspaces": [
            { "id": "wsp_1", "agent_id": id, "environment": "chrome", "name": "Research",
              "state": "ready", "os_status": "running" }
        ] }),
    );
    state.answer_at(
        &format!("/api/v1/agents/{id}/theme"),
        json!({ "data": { "supported": true, "saved": true, "theme": { "v": 1, "accent": "agent",
            "wallpaper": { "manifest": { "layers": [{ "engine": "nebula" }] },
                "source": { "kind": "gallery", "id": "wg_1", "name": "Dusk", "author": "Mina" } } } } }),
    );
    state.answer_at(
        &format!("/api/v1/ai/agents/{id}/memories"),
        json!({ "success": true, "data": { "items": [
            { "id": "m1", "category": "procedural", "value": { "text": "Answer in Korean" } },
            { "id": "m2", "category": "semantic", "value": { "text": "Likes tea" } },
            { "id": "m3", "category": "procedural", "archived_at": "2026-11-01T09:00:00Z" },
            { "id": "m4", "category": "episodic", "archived_at": null }
        ], "total": 4 } }),
    );
    state.answer_at(
        "/api/v1/me/api-keys",
        json!({ "items": [
            { "id": "key_1", "name": "Shop", "key_prefix": "sk_live_ab12", "agent_id": id,
              "scopes": ["invoke"], "expires_at": "2027-01-01T00:00:00Z",
              "last_used_at": "2026-11-02T06:00:00Z", "created_at": "2026-11-01T09:00:00Z" },
            { "id": "key_2", "name": "Everything", "key_prefix": "sk_live_cd34", "agent_id": null },
            { "id": "key_3", "name": "Other", "key_prefix": "sk_live_ef56", "agent_id": other }
        ], "scope_catalog": ["invoke"] }),
    );
    state.answer_at(
        "/api/v1/artifacts",
        json!({ "data": [{ "id": "art_9", "agent_id": id, "filename": "plan.md",
            "updated_at": "2026-11-02T07:00:00Z" }],
            "meta": { "pagination": { "total": 7, "page": 1, "limit": 1, "has_next_page": true } } }),
    );
}

#[test]
fn facets_read_every_row_of_the_board() {
    let fake = FakePlatform::start();
    let core = desk("studio-rows", &fake);
    let (id, other) = {
        let mut state = fake.state();
        (
            state.add_agent("Miso", "Mail"),
            state.add_agent("Kept", "x"),
        )
    };
    seed_rows(&fake, &id, &other);
    let facets = studio(&core, "studio.agents.facets", json!({ "agentId": id })).unwrap();
    assert_eq!(facets["problems"], json!([]));
    assert_eq!(
        facets["channels"],
        json!([
            { "id": "cp_1", "provider": "slack", "name": "Acme", "status": "active",
              "lastActiveAt": "2026-11-02T08:00:00Z" },
            { "id": "cp_2", "provider": "discord", "name": "Guild", "status": "pending" }
        ])
    );
    // Only the key made for this agent, and neither its prefix nor its scopes.
    assert_eq!(
        facets["apiKeys"],
        json!([{ "id": "key_1", "name": "Shop", "expiresAt": "2027-01-01T00:00:00Z",
            "lastUsedAt": "2026-11-02T06:00:00Z", "createdAt": "2026-11-01T09:00:00Z" }])
    );
    // The workspace's own device is the workspace, counted once.
    assert_eq!(
        facets["devices"],
        json!([
            { "id": "dev_1", "kind": "computer", "name": "My Mac", "workspace": false },
            { "id": "dev_2", "kind": "android", "name": "Pixel", "workspace": false },
            { "id": "wsp_1", "kind": "chrome", "name": "Research", "workspace": true }
        ])
    );
    assert_eq!(
        facets["memory"],
        json!({ "memories": 3, "rules": 1, "more": false })
    );
    assert_eq!(
        facets["outputs"],
        json!({ "count": 7, "latestAt": "2026-11-02T07:00:00Z" })
    );
    assert_eq!(
        facets["theme"],
        json!({ "wallpaper": { "source": "gallery", "id": "wg_1", "name": "Dusk", "author": "Mina" } })
    );
    let text = facets.to_string();
    for secret in [
        "sk_live",
        "Answer in Korean",
        "Likes tea",
        "nebula",
        "plan.md",
    ] {
        assert!(!text.contains(secret), "{secret} crossed the bridge");
    }
    let memories = &fake.seen_at("GET", &format!("/api/v1/ai/agents/{id}/memories"))[0];
    assert_eq!(memories.query["limit"], "200");
    let artifacts = &fake.seen_at("GET", "/api/v1/artifacts")[0];
    assert_eq!(
        (
            artifacts.query["agent_id"].as_str(),
            artifacts.query["limit"].as_str()
        ),
        (id.as_str(), "1")
    );
}

#[test]
fn a_fresh_agent_has_empty_rows_and_no_wallpaper() {
    let fake = FakePlatform::start();
    let core = desk("studio-rows-fresh", &fake);
    let id = fake.state().add_agent("Miso", "Mail");
    let facets = studio(&core, "studio.agents.facets", json!({ "agentId": id })).unwrap();
    assert_eq!(facets["problems"], json!([]));
    for list in ["channels", "apiKeys", "devices"] {
        assert_eq!(facets[list], json!([]), "{list}");
    }
    assert_eq!(
        facets["memory"],
        json!({ "memories": 0, "rules": 0, "more": false })
    );
    assert_eq!(facets["outputs"], json!({ "count": 0 }));
    assert_eq!(facets["theme"], json!({}));
}

#[test]
fn workspaces_turned_off_are_none_and_a_row_endue_ai_refuses_is_named() {
    let fake = FakePlatform::start();
    let core = desk("studio-rows-problems", &fake);
    let (id, other) = {
        let mut state = fake.state();
        (
            state.add_agent("Miso", "Mail"),
            state.add_agent("Kept", "x"),
        )
    };
    seed_rows(&fake, &id, &other);
    {
        let mut state = fake.state();
        let workspaces = format!("/api/v1/agents/{id}/workspaces");
        state.fail_at(&workspaces, 404, "FEATURE_DISABLED", "Workspaces are off");
        let memories = format!("/api/v1/ai/agents/{id}/memories");
        state.fail_at(&memories, 503, "UNAVAILABLE", "memory is down");
        state.fail_at("/api/v1/artifacts", 404, "NOT_FOUND", "No such route");
        let theme = format!("/api/v1/agents/{id}/theme");
        state.answer_at(
            &theme,
            json!({ "supported": false, "saved": false, "theme": { "wallpaper": null } }),
        );
    }
    let facets = studio(&core, "studio.agents.facets", json!({ "agentId": id })).unwrap();
    let devices: Vec<&str> = facets["devices"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["id"].as_str().unwrap())
        .collect();
    assert_eq!(
        devices,
        ["dev_1", "dev_2"],
        "no workspace, and its device is left out"
    );
    assert!(facets.get("memory").is_none());
    assert!(facets.get("outputs").is_none());
    assert_eq!(facets["theme"], json!({}));
    let named: Vec<(&str, &str)> = facets["problems"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| (p["facet"].as_str().unwrap(), p["code"].as_str().unwrap()))
        .collect();
    assert_eq!(named, [("memory", "io_error"), ("outputs", "not_found")]);
}
