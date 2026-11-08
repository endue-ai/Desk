//! studio.* beyond one agent's round trip: a facet endue AI does not answer, the catalog, and the
//! Home board's conversations.

use super::*;

#[test]
fn facets_name_what_endue_ai_did_not_answer() {
    let fake = FakePlatform::start();
    let core = desk("studio-facets", &fake);
    let id = fake.state().add_agent("Miso", "Mail");
    let path = format!("/api/v1/agents/{id}/connectors");
    fake.state()
        .fail_at(&path, 503, "UNAVAILABLE", "connectors are down");
    let facets = studio(&core, "studio.agents.facets", json!({ "agentId": id })).unwrap();
    assert_eq!(facets["connectors"], json!([]));
    assert_eq!(
        facets["problems"],
        json!([{ "facet": "connectors", "code": "io_error",
        "message": "connectors are down" }])
    );
    assert_eq!(facets["identity"]["role"], "Mail");
    assert!(facets.get("prompt").is_none(), "no prompt yet");
}

#[test]
fn catalog_finds_and_starts_an_agent() {
    let fake = FakePlatform::start();
    let core = desk("studio-catalog", &fake);
    let listed = studio(&core, "studio.catalog.list", json!({ "query": "mail" })).unwrap();
    let first = &listed["agents"][0];
    assert_eq!(
        (first["slug"].as_str(), first["name"].as_str()),
        (Some("support-mail"), Some("Mailie"))
    );
    assert_eq!(
        first["role"],
        json!({ "en": "Support mail", "ko": "고객 메일" })
    );
    assert_eq!(
        first["useCases"][0]["example"]["en"],
        "Answer this refund mail"
    );
    assert_eq!(
        fake.seen_at("GET", "/api/v1/agent-catalog/agents")[0].query["q"],
        "mail"
    );

    let found = studio(
        &core,
        "studio.catalog.recommend",
        json!({ "query": "answer my mail", "locale": "ko" }),
    )
    .unwrap();
    assert_eq!(
        found,
        json!({ "matches": [{ "slug": "support-mail", "reason": "It works with mail." }], "source": "keyword" })
    );

    let used = studio(
        &core,
        "studio.catalog.use",
        json!({ "slug": "support-mail", "locale": "ko" }),
    )
    .unwrap();
    assert_eq!(
        used["agent"]["sourceCatalog"],
        json!({ "catalogAgentId": "cat_support_mail", "version": 3 })
    );
    assert_eq!(used["catalog"]["slug"], "support-mail");
    assert_eq!(
        used["warnings"],
        json!([{ "step": "model", "code": "MODEL_NOT_ALLOWED" }])
    );
    assert_eq!(
        used["recommended"]["connectors"],
        json!([{ "type": "gmail", "required": true }])
    );
    let mine = studio(&core, "studio.agents.list", json!({})).unwrap();
    assert_eq!(mine["agents"][0]["id"], used["agent"]["id"]);
}

#[test]
fn conversations_list_filters_by_agent() {
    let fake = FakePlatform::start();
    let core = desk("studio-conversations", &fake);
    let (miso, kept) = {
        let mut state = fake.state();
        let miso = state.add_agent("Miso", "Mail");
        (miso, state.add_agent("Kept", "x"))
    };
    {
        let mut state = fake.state();
        state.add_conversation(&miso, "Refund", Some("completed"), true);
        state.add_conversation(&kept, "Other", Some("running"), false);
        state.add_conversation(&miso, "Order", Some("failed"), false);
        state.add_conversation(&miso, "Hello", Some("running"), false);
        state.add_conversation(&miso, "Done", None, false);
    }
    let page = studio(
        &core,
        "studio.conversations.list",
        json!({ "agentId": miso, "limit": 3 }),
    )
    .unwrap();
    let seen = &fake.seen_at("GET", "/api/v1/ai/conversations")[0];
    assert_eq!(seen.query["agent_id"], miso);
    let rows: Vec<(&str, &str)> = page["conversations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            (
                c["title"].as_str().unwrap(),
                c["activity"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        rows,
        [("Done", "done"), ("Hello", "active"), ("Order", "failed")]
    );
    assert!(
        page["conversations"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["agentId"] == miso.as_str())
    );
    assert_eq!(
        (page["total"].as_u64(), page["hasMore"].as_bool()),
        (Some(4), Some(true))
    );
    assert_eq!(page["conversations"][2]["lastRunErrorCode"], "LLM_TIMEOUT");

    let next = studio(
        &core,
        "studio.conversations.list",
        json!({ "agentId": miso, "limit": 3, "page": 2 }),
    )
    .unwrap();
    assert_eq!(next["conversations"][0]["activity"], "waiting");
    assert_eq!(next["hasMore"], false);
    let waiting = studio(
        &core,
        "studio.conversations.list",
        json!({ "awaitingInput": true }),
    )
    .unwrap();
    assert_eq!(waiting["total"], 1);
    assert_eq!(waiting["conversations"][0]["title"], "Refund");
    let all = studio(&core, "studio.conversations.list", json!({})).unwrap();
    assert_eq!(all["total"], 5);
}
