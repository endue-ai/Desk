//! The `perm` log channel (ADR 0072): every grant, every refusal and every call of an agent, with
//! its caller, permission, scope, decision and target.

mod support;

use std::fs;

use desk_core::Core;
use serde_json::{Value, json};
use support::*;

const MIRA: &str = "agent:mira";

/// The `perm` channel's entries, oldest first, as `desk` (holding log:read) reads them.
fn perm_log(core: &Core) -> Vec<Value> {
    let tail = call(
        core,
        "desk",
        "log.tail",
        json!({ "channel": "perm", "count": 1000, "scope": { "permission": "log:read" } }),
    )
    .unwrap();
    tail["entries"].as_array().unwrap().clone()
}

fn with_decision<'a>(entries: &'a [Value], decision: &str) -> Vec<&'a Value> {
    entries
        .iter()
        .filter(|e| e["fields"]["decision"] == decision)
        .collect()
}

#[test]
fn grants_refusals_and_agent_calls_go_to_the_perm_channel() {
    let home = home("perm-log");
    let file = home.join("init.yaml");
    fs::write(
        &file,
        "agents:\n  mira:\n    allow:\n      - { permission: fs:write, paths: [\"~/Notes/**\"] }\n",
    )
    .unwrap();
    let core = Core::new(roots(&home)).with_init_file(file);
    grant(&core, "desk", json!({ "permission": "log:read" }));
    let notes = json!({ "permission": "fs:write", "paths": ["~/Notes/**"] });
    let granted_id = grant(&core, MIRA, notes.clone());
    let write = |path: &str, scope: &str| {
        let scope = json!({ "permission": "fs:write", "paths": [scope] });
        call(
            &core,
            MIRA,
            "fs.write",
            json!({ "path": path, "content": "hi", "createDirs": true, "scope": scope }),
        )
    };
    write("~/Notes/a.md", "~/Notes/**").unwrap();
    write("~/Desktop/x.txt", "~/Desktop/**").unwrap_err();

    let entries = perm_log(&core);
    assert!(entries.iter().all(|e| e["channel"] == "perm"));
    let granted = with_decision(&entries, "granted");
    let mira = granted
        .iter()
        .find(|e| e["fields"]["caller"] == MIRA)
        .expect("mira's grant is logged");
    assert_eq!(mira["level"], "info");
    assert_eq!(mira["fields"]["permission"], "fs:write");
    assert_eq!(mira["fields"]["scope"], notes);
    assert_eq!(mira["fields"]["duration"], "session");
    assert_eq!(mira["fields"]["grantId"], granted_id.as_str());
    assert!(
        granted.iter().any(|e| e["fields"]["caller"] == "desk"),
        "start-up grants are logged too"
    );

    let allowed = with_decision(&entries, "allowed");
    assert_eq!(allowed.len(), 1, "{allowed:?}");
    assert_eq!(allowed[0]["fields"]["caller"], MIRA);
    assert_eq!(allowed[0]["fields"]["permission"], "fs:write");
    assert_eq!(allowed[0]["fields"]["scope"], notes);
    assert_eq!(allowed[0]["fields"]["target"], "~/Notes/a.md");

    let refused = with_decision(&entries, "refused");
    assert_eq!(refused.len(), 1, "{refused:?}");
    assert_eq!(refused[0]["level"], "warn");
    assert_eq!(refused[0]["fields"]["caller"], MIRA);
    assert_eq!(refused[0]["fields"]["reason"], "outside-allowlist");
    assert_eq!(refused[0]["fields"]["target"], "~/Desktop/x.txt");
    assert_eq!(
        refused[0]["fields"]["scope"],
        json!({ "permission": "fs:write", "paths": ["~/Desktop/**"] })
    );
    assert!(refused[0]["message"].as_str().unwrap().contains(MIRA));
}

#[test]
fn a_plugins_refused_request_is_logged() {
    let home = home("perm-log-plugin");
    // No perm:manage holder and the default prompter: the request is refused.
    let core = Core::new(roots(&home));
    grant(&core, "desk", json!({ "permission": "log:read" }));
    let asked = call(
        &core,
        NOTES,
        "perm.request",
        json!({ "permission": notes_read(), "reason": "To open your notes" }),
    )
    .unwrap();
    assert_eq!(asked["granted"], false);
    let entries = perm_log(&core);
    let refused = with_decision(&entries, "refused");
    assert_eq!(refused.len(), 1, "{entries:?}");
    assert_eq!(refused[0]["fields"]["caller"], NOTES);
    assert_eq!(refused[0]["fields"]["permission"], "fs:read");
    assert_eq!(refused[0]["fields"]["scope"], notes_read());
    assert!(refused[0]["fields"].get("target").is_none());
    assert!(
        with_decision(&entries, "allowed").is_empty(),
        "plugins' calls are not logged"
    );
}
