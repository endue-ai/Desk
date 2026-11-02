//! Agents are callers (ADR 0072): `agent:<id>` holds grants of its own, is capped by
//! `agents.<id>.allow` in init.yaml, is asked about inside it and refused outside it with a notice.

mod support;

use std::fs;
use std::path::Path;
use std::sync::mpsc::Receiver;

use desk_bridge::{BridgeError, ErrorCode};
use desk_core::{Core, Delivery};
use serde_json::{Value, json};
use support::*;

const MIRA: &str = "agent:mira";
const THEO: &str = "agent:theo";

/// init.yaml capping mira to writing under `~/Notes`.
const NOTES_ONLY: &str =
    "agents:\n  mira:\n    allow:\n      - { permission: fs:write, paths: [\"~/Notes/**\"] }\n";

/// A core reading `init` from `home/init.yaml`, with `desk` holding perm:manage and listening as the
/// router, so prompts go out as `perm.prompt` and the Prompter is never asked.
fn core_with(home: &Path, init: &str) -> (Core, Receiver<Delivery>) {
    let file = home.join("init.yaml");
    fs::write(&file, init).unwrap();
    let core = Core::new(roots(home))
        .with_prompter(NeverAsk)
        .with_init_file(file);
    grant(&core, "desk", manage());
    let deliveries = core.events().subscribe_addressed();
    (core, deliveries)
}

fn fs_write(paths: &[&str]) -> Value {
    json!({ "permission": "fs:write", "paths": paths })
}

fn write(core: &Core, caller: &str, path: &str, scope: &str) -> Result<Value, BridgeError> {
    call(
        core,
        caller,
        "fs.write",
        json!({ "path": path, "content": "hi", "createDirs": true, "scope": fs_write(&[scope]) }),
    )
}

/// perm.answer as `desk`, the person's prompter.
fn answer(core: &Core, prompt: &Seen, decision: Value) {
    let mut params = json!({ "promptId": prompt.data()["promptId"], "scope": manage() });
    params
        .as_object_mut()
        .unwrap()
        .extend(decision.as_object().cloned().unwrap());
    call(core, "desk", "perm.answer", params).unwrap();
}

fn request(core: &Core, caller: &str, permission: Value) -> Value {
    call(
        core,
        caller,
        "perm.request",
        json!({ "permission": permission }),
    )
    .unwrap()
}

#[test]
fn an_agent_is_refused_outside_its_allowlist_even_with_a_grant() {
    let home = home("agent-cap");
    let (core, deliveries) = core_with(&home, NOTES_ONLY);
    grant(&core, MIRA, fs_write(&["~/**"]));

    let refused = write(&core, MIRA, "~/Desktop/x.txt", "~/Desktop/**").unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied);
    assert_eq!(
        serde_json::to_value(&refused.permission).unwrap(),
        fs_write(&["~/Desktop/**"])
    );
    assert!(!home.join("Desktop/x.txt").exists());
    assert_eq!(
        request(&core, MIRA, fs_write(&["~/Desktop/**"])),
        json!({ "granted": false, "reason": "outside-allowlist" })
    );
    assert!(
        named(&deliveries, "perm.prompt").is_empty(),
        "nobody is asked"
    );
    // Inside the allowlist the grant it holds still counts (and the write waits for approval).
    approved_once(&core, &deliveries, || {
        write(&core, MIRA, "~/Notes/a.md", "~/Notes/**")
    })
    .unwrap();
}

#[test]
fn a_refusal_outside_the_allowlist_sends_a_notice_naming_the_agent() {
    let home = home("agent-notice");
    let (core, deliveries) = core_with(&home, NOTES_ONLY);
    write(&core, MIRA, "~/Desktop/x.txt", "~/Desktop/**").unwrap_err();
    let notices = named(&deliveries, "ui.notified");
    assert_eq!(notices.len(), 1, "{notices:?}");
    let data = notices[0].data();
    assert_eq!(data["caller"], "core");
    assert_eq!(data["level"], "warning");
    assert!(
        data["title"].as_str().unwrap().contains("mira"),
        "the notice names the agent: {data}"
    );
}

#[test]
fn within_the_allowlist_the_person_is_prompted_and_the_answer_is_remembered_per_agent() {
    let home = home("agent-prompt");
    let (core, deliveries) = core_with(&home, NOTES_ONLY);
    std::thread::scope(|s| {
        let writing = s.spawn(|| write(&core, MIRA, "~/Notes/a.md", "~/Notes/**"));
        let prompt = wait_for(&deliveries, "perm.prompt");
        assert_eq!(prompt.to, strings(&["desk"]));
        assert_eq!(prompt.data()["caller"], MIRA);
        assert_eq!(prompt.data()["permission"], fs_write(&["~/Notes/**"]));
        answer(
            &core,
            &prompt,
            json!({ "granted": true, "duration": "session" }),
        );
        let approval = wait_for(&deliveries, "perm.approval");
        approve_as_desk(&core, &approval, "once");
        writing.join().unwrap().unwrap();
    });
    assert_eq!(fs::read_to_string(home.join("Notes/a.md")).unwrap(), "hi");
    approved_once(&core, &deliveries, || {
        write(&core, MIRA, "~/Notes/b.md", "~/Notes/**")
    })
    .unwrap();
    assert!(named(&deliveries, "perm.prompt").is_empty(), "asked once");

    // Another agent holds nothing of mira's: it is asked, and its refusal is its own.
    std::thread::scope(|s| {
        let writing = s.spawn(|| write(&core, THEO, "~/Notes/c.md", "~/Notes/**"));
        let prompt = wait_for(&deliveries, "perm.prompt");
        assert_eq!(prompt.data()["caller"], THEO);
        answer(&core, &prompt, json!({ "granted": false }));
        let refused = writing.join().unwrap().unwrap_err();
        assert_eq!(refused.code, ErrorCode::PermissionDenied);
    });
    let again = write(&core, THEO, "~/Notes/c.md", "~/Notes/**").unwrap_err();
    assert_eq!(again.code, ErrorCode::PermissionDenied);
    assert_eq!(
        request(&core, THEO, fs_write(&["~/Notes/**"])),
        json!({ "granted": false, "reason": "refused-earlier" })
    );
    assert_eq!(
        request(&core, MIRA, fs_write(&["~/Notes/**"]))["granted"],
        true
    );
    assert!(named(&deliveries, "perm.prompt").is_empty());
}

#[test]
fn an_empty_allowlist_prompts_on_every_first_use() {
    let home = home("agent-empty");
    let (core, deliveries) = core_with(&home, "agents:\n  theo:\n    allow: []\n");
    for agent in [THEO, "agent:kai"] {
        std::thread::scope(|s| {
            let writing = s.spawn(|| write(&core, agent, "~/Desktop/x.txt", "~/Desktop/**"));
            let prompt = wait_for(&deliveries, "perm.prompt");
            assert_eq!(prompt.data()["caller"], agent);
            answer(
                &core,
                &prompt,
                json!({ "granted": true, "duration": "once" }),
            );
            let approval = wait_for(&deliveries, "perm.approval");
            approve_as_desk(&core, &approval, "once");
            writing.join().unwrap().unwrap();
        });
        std::thread::scope(|s| {
            let asking = s.spawn(|| request(&core, agent, notes_read()));
            let prompt = wait_for(&deliveries, "perm.prompt");
            answer(&core, &prompt, json!({ "granted": false }));
            assert_eq!(asking.join().unwrap(), json!({ "granted": false }));
        });
    }
    assert!(named(&deliveries, "ui.notified").is_empty());
}

/// perm.request for `~/Pictures/2026/<folder>/**` as `agent`, answered once; the prompt's parent.
fn ask_folder(core: &Core, deliveries: &Receiver<Delivery>, agent: &str, folder: &str) -> Value {
    let wanted =
        json!({ "permission": "fs:read", "paths": [format!("~/Pictures/2026/{folder}/**")] });
    std::thread::scope(|s| {
        let asking = s.spawn(|| request(core, agent, wanted.clone()));
        let prompt = wait_for(deliveries, "perm.prompt");
        answer(
            core,
            &prompt,
            json!({ "granted": true, "duration": "once" }),
        );
        assert_eq!(asking.join().unwrap()["granted"], true);
        prompt.data()["parent"].clone()
    })
}

#[test]
fn the_parent_offer_stays_inside_the_allowlist() {
    let home = home("agent-parent");
    let init = "agents:\n  mira:\n    allow:\n      - { permission: fs:read, paths: [\"~/Pictures/2026/a/**\", \"~/Pictures/2026/b/**\", \"~/Pictures/2026/c/**\"] }\n  theo:\n    allow:\n      - { permission: fs:read, paths: [\"~/Pictures/**\"] }\n";
    let (core, deliveries) = core_with(&home, init);
    for folder in ["a", "b", "c"] {
        let parent = ask_folder(&core, &deliveries, MIRA, folder);
        assert_eq!(parent, Value::Null, "never beyond mira's allowlist");
    }
    ask_folder(&core, &deliveries, THEO, "a");
    ask_folder(&core, &deliveries, THEO, "b");
    assert_eq!(
        ask_folder(&core, &deliveries, THEO, "c"),
        json!({ "permission": "fs:read", "paths": ["~/Pictures/2026/**"] })
    );
}

#[test]
fn an_edit_to_the_allowlist_applies_to_the_next_call() {
    let home = home("agent-edit");
    let (core, deliveries) = core_with(&home, NOTES_ONLY);
    grant(&core, MIRA, fs_write(&["~/Notes/**"]));
    approved_once(&core, &deliveries, || {
        write(&core, MIRA, "~/Notes/a.md", "~/Notes/**")
    })
    .unwrap();
    fs::write(
        home.join("init.yaml"),
        NOTES_ONLY.replace("~/Notes/**", "~/Other/**"),
    )
    .unwrap();
    let refused = write(&core, MIRA, "~/Notes/b.md", "~/Notes/**").unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied);
    let seen: Vec<String> = drain(&deliveries)
        .iter()
        .map(|d| d.name().to_owned())
        .filter(|name| name == "perm.prompt" || name == "ui.notified")
        .collect();
    assert_eq!(seen, ["ui.notified"], "a notice, and nobody is asked");
}

#[test]
fn an_agents_always_grant_is_its_own_in_the_grant_file() {
    let home = home("agent-always");
    let grants = home.join("grants.json");
    let (core, deliveries) = core_with(&home, NOTES_ONLY);
    let core = core.with_grant_file(grants.clone());
    grant(&core, "desk", manage());
    std::thread::scope(|s| {
        let writing = s.spawn(|| write(&core, MIRA, "~/Notes/a.md", "~/Notes/**"));
        let prompt = wait_for(&deliveries, "perm.prompt");
        answer(
            &core,
            &prompt,
            json!({ "granted": true, "duration": "always" }),
        );
        writing.join().unwrap().unwrap();
    });
    let file: Value = serde_json::from_str(&fs::read_to_string(&grants).unwrap()).unwrap();
    assert_eq!(file["grants"][0]["caller"], MIRA);
    assert_eq!(
        file["grants"][0]["grant"]["permission"],
        fs_write(&["~/Notes/**"])
    );

    let (again, deliveries) = core_with(&home, NOTES_ONLY);
    let again = again.with_grant_file(grants);
    grant(&again, "desk", manage());
    let listed = call(
        &again,
        "desk",
        "perm.list",
        json!({ "caller": MIRA, "scope": manage() }),
    );
    assert_eq!(listed.unwrap()["grants"][0]["caller"], MIRA);
    write(&again, MIRA, "~/Notes/b.md", "~/Notes/**").unwrap();
    assert!(named(&deliveries, "perm.prompt").is_empty());
}

/// brain.ask, theme.* and update.* (ADR 0059, 0058, 0054) are capped like any other call: outside
/// the list they are refused without asking, whatever the agent holds; named in it, its grants count.
#[test]
fn brain_ask_theme_manage_and_update_manage_are_capped_like_any_other() {
    let home = home("agent-newer");
    let (core, deliveries) = core_with(&home, NOTES_ONLY);
    let ask = json!({ "prompt": "Name a colour",
        "tool": { "name": "colour", "description": "A colour", "schema": { "type": "object" } } });
    let calls = [
        ("brain:ask", "brain.ask", ask),
        (
            "theme:manage",
            "theme.remove",
            json!({ "theme": "user.gone" }),
        ),
        ("update:manage", "update.status", json!({})),
    ];
    let with_scope = |params: &Value, permission: &Value| {
        let mut params = params.clone();
        params["scope"] = permission.clone();
        params
    };
    for (name, method, params) in &calls {
        let permission = json!({ "permission": name });
        grant(&core, MIRA, permission.clone());
        let refused = call(&core, MIRA, method, with_scope(params, &permission)).unwrap_err();
        assert_eq!(refused.code, ErrorCode::PermissionDenied, "{method}");
        assert_eq!(
            request(&core, MIRA, permission),
            json!({ "granted": false, "reason": "outside-allowlist" })
        );
    }
    assert!(
        named(&deliveries, "perm.prompt").is_empty(),
        "nobody is asked"
    );

    let allow = "agents:\n  mira:\n    allow:\n      - { permission: brain:ask }\n      - { permission: theme:manage }\n      - { permission: update:manage }\n";
    fs::write(home.join("init.yaml"), allow).unwrap();
    for (name, method, params) in &calls {
        let permission = json!({ "permission": name });
        let answered = call(&core, MIRA, method, with_scope(params, &permission));
        // Past the check: no brain, no updater and no such theme here.
        let code = answered.unwrap_err().code;
        assert_ne!(code, ErrorCode::PermissionDenied, "{method}");
        assert_eq!(request(&core, MIRA, permission)["granted"], true, "{name}");
    }
    assert!(
        named(&deliveries, "perm.prompt").is_empty(),
        "the grants it holds count"
    );
}
