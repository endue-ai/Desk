//! Search crosses plugin boundaries only through explicitly published, permission-checked documents.
use desk_bridge::{BridgeResponse, ErrorCode};
use desk_core::{Core, Roots};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn call(core: &Core, caller: &str, method: &str, params: Value) -> Result<Value, ErrorCode> {
    let request = serde_json::from_value(json!({"id":1,"method":method,"params":params})).unwrap();
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(r) => Ok(r.result),
        BridgeResponse::BridgeFailure(r) => Err(r.error.code),
    }
}
fn core(file: Option<&Path>) -> Core {
    let mut core = Core::new(Roots {
        home: std::env::temp_dir(),
    });
    if let Some(file) = file {
        core = core.with_store_file(file.into());
    }
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../plugins");
    core.install_plugin(&root.join("notes"), true);
    core.install_plugin(&root.join("eris"), true);
    for scope in [
        json!({"permission":"search:read"}),
        json!({"permission":"plugin:manage"}),
    ] {
        core.grant("palette", serde_json::from_value(scope).unwrap());
    }
    core
}
fn query(core: &Core, q: &str) -> Vec<Value> {
    call(
        core,
        "palette",
        "search.query",
        json!({"query":q,"scope":{"permission":"search:read"}}),
    )
    .unwrap()["hits"]
        .as_array()
        .unwrap()
        .clone()
}
fn publish(core: &Core, caller: &str, docs: Value) -> Result<Value, ErrorCode> {
    call(core, caller, "search.replace", json!({"documents":docs}))
}

#[test]
fn searches_titles_and_content_in_multiple_plugins_without_reading_private_store() {
    let core = core(None);
    publish(&core, "endue.notes", json!([{"id":"a","title":"회의 기록","text":"다음 주 서울 출장","command":"endue.notes.search-open","args":{"path":"~/Notes/a.md"}}])).unwrap();
    publish(
        &core,
        "endue.eris",
        json!([{"id":"a","title":"서울 일정","text":"출장"}]),
    )
    .unwrap();
    call(
        &core,
        "endue.notes",
        "store.set",
        json!({"key":"secret","value":"서울 비밀"}),
    )
    .unwrap();
    let hits = query(&core, "서울 출장");
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0]["kind"], "document");
    assert_ne!(hits[0]["id"], hits[1]["id"]);
    assert!(query(&core, "비밀").is_empty());
    assert_eq!(query(&core, "Notes")[0]["kind"], "plugin");
    assert_eq!(
        call(
            &core,
            "untrusted",
            "search.query",
            json!({"query":"서울","scope":{"permission":"search:read"}})
        ),
        Err(ErrorCode::PermissionDenied)
    );
}

#[test]
fn replacement_clear_disable_and_restart_do_not_leave_stale_or_cross_owner_documents() {
    let file = std::env::temp_dir().join(format!(
        "desk-search-{}-{}.json",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let first = core(Some(&file));
    publish(
        &first,
        "endue.notes",
        json!([{"id":"1","title":"Original"}]),
    )
    .unwrap();
    publish(&first, "endue.eris", json!([{"id":"1","title":"Other"}])).unwrap();
    let core = core(Some(&file));
    assert_eq!(query(&core, "Original").len(), 1);
    publish(
        &core,
        "endue.notes",
        json!([{"id":"2","title":"Replacement"}]),
    )
    .unwrap();
    assert!(query(&core, "Original").is_empty());
    assert_eq!(
        query(&core, "Other")
            .iter()
            .filter(|h| h["kind"] == "document")
            .count(),
        1
    );
    call(
        &core,
        "palette",
        "plugin.setEnabled",
        json!({"plugin":"endue.notes","enabled":false,"scope":{"permission":"plugin:manage"}}),
    )
    .unwrap();
    assert!(query(&core, "Replacement").is_empty());
    assert_eq!(query(&core, "Notes")[0]["kind"], "plugin");
    call(
        &core,
        "palette",
        "plugin.setEnabled",
        json!({"plugin":"endue.notes","enabled":true,"scope":{"permission":"plugin:manage"}}),
    )
    .unwrap();
    publish(&core, "endue.notes", json!([])).unwrap();
    assert!(query(&core, "Replacement").is_empty());
    std::fs::remove_file(file).unwrap();
}

#[test]
fn invalid_documents_are_rejected_atomically_and_os_paths_cannot_be_forged() {
    let core = core(None);
    publish(&core, "endue.notes", json!([{"id":"1","title":"Kept"}])).unwrap();
    for docs in [
        json!([{"id":"1","title":"Bad","command":"desk.files.open"}]),
        json!([{"id":"1","title":"a"},{"id":"1","title":"b"}]),
        json!([{"id":"2","title":"","text":"x"}]),
        json!([{"id":"2","title":"Too big","text":"x".repeat(17000)}]),
    ] {
        assert_eq!(
            publish(&core, "endue.notes", docs),
            Err(ErrorCode::InvalidParams)
        );
    }
    assert_eq!(query(&core, "Kept").len(), 1);
    assert_eq!(
        publish(&core, "not.installed", json!([])),
        Err(ErrorCode::PermissionDenied)
    );
    assert_eq!(
        call(
            &core,
            "palette",
            "search.system",
            json!({"query":"file","scope":{"permission":"search:system"}})
        ),
        Err(ErrorCode::PermissionDenied)
    );
    core.grant(
        "palette",
        serde_json::from_value(json!({"permission":"search:system"})).unwrap(),
    );
    assert_eq!(
        call(
            &core,
            "palette",
            "search.open",
            json!({"id":"/etc/passwd","scope":{"permission":"search:system"}})
        ),
        Err(ErrorCode::NotFound)
    );
}
