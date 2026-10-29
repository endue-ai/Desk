//! Grants that last (ADR 0029): `always` grants live in one JSON file and are loaded at start,
//! `session` and `once` grants stay in memory, a `once` grant is spent by the first call it allows,
//! and a perm:manage holder lists and revokes every caller's grants.

mod support;

use std::fs;
use std::path::{Path, PathBuf};

use desk_bridge::ErrorCode;
use desk_core::Core;
use serde_json::{Value, json};
use support::*;

/// A core keeping its grants in `data/grants.json` under `home`, whose person says yes.
fn stored(home: &Path) -> (PathBuf, Core) {
    let file = home.join("data/grants.json");
    let core = Core::new(roots(home))
        .with_grant_file(file.clone())
        .with_prompter(SayYes);
    (file, core)
}

/// Another start on the same file.
fn restart(home: &Path, file: &Path) -> Core {
    Core::new(roots(home))
        .with_grant_file(file.to_path_buf())
        .with_prompter(SayYes)
}

fn request(core: &Core, caller: &str, permission: Value, duration: &str) -> Value {
    call(
        core,
        caller,
        "perm.request",
        json!({ "permission": permission, "reason": "To open your files", "duration": duration }),
    )
    .unwrap()
}

/// The grants the file holds, as `[{ caller, grant }]`; none when there is no file.
fn file_grants(file: &Path) -> Vec<Value> {
    match fs::read_to_string(file) {
        Ok(text) => {
            let value: Value = serde_json::from_str(&text).unwrap();
            assert_eq!(value["version"], 1);
            value["grants"].as_array().unwrap().clone()
        }
        Err(_) => Vec::new(),
    }
}

fn ids(grants: &[Value]) -> Vec<Value> {
    grants.iter().map(|g| g["grantId"].clone()).collect()
}

#[test]
fn an_always_grant_is_written_to_the_grant_file_and_loaded_at_start() {
    let home = home("grants-always");
    let (file, core) = stored(&home);
    let answer = request(&core, NOTES, notes_read(), "always");
    assert_eq!(answer["granted"], true);
    let grant = answer["grant"].clone();
    assert_eq!(grant["duration"], "always");
    assert_eq!(grant["permission"], notes_read());
    assert_eq!(
        file_grants(&file),
        vec![json!({ "caller": NOTES, "grant": grant })]
    );

    let again = restart(&home, &file);
    assert_eq!(query(&again, NOTES), vec![grant]);
    assert_eq!(
        read_hello(&again, NOTES).unwrap(),
        json!({ "content": "# Hello", "encoding": "utf8" })
    );
}

#[test]
fn session_and_once_grants_never_reach_the_file() {
    let home = home("grants-memory");
    let (file, core) = stored(&home);
    grant(&core, NOTES, notes_read());
    let once = request(&core, CALENDAR, calendar_read(), "once");
    assert_eq!(once["grant"]["duration"], "once");
    assert_eq!(file_grants(&file), Vec::<Value>::new());

    let again = restart(&home, &file);
    assert!(query(&again, NOTES).is_empty());
    assert!(query(&again, CALENDAR).is_empty());
}

#[test]
fn a_once_grant_allows_one_call_then_expires() {
    let home = home("grants-once");
    let core = Core::new(roots(&home)).with_prompter(SayYes);
    let deliveries = core.events().subscribe_addressed();
    let grant = request(&core, NOTES, notes_read(), "once")["grant"].clone();
    assert_eq!(grant["duration"], "once");
    assert!(grant.get("expiresAt").is_none(), "no v0 duration is timed");

    assert!(read_hello(&core, NOTES).is_ok());
    let expired: Vec<Seen> = named(&deliveries, "perm.changed")
        .into_iter()
        .filter(|d| d.data()["change"] == "expired")
        .collect();
    assert_eq!(expired.len(), 1);
    assert_eq!(expired[0].data()["grantId"], grant["grantId"]);
    assert_eq!(expired[0].to, strings(&[NOTES]));

    let denied = read_hello(&core, NOTES).unwrap_err();
    assert_eq!(denied.code, ErrorCode::PermissionDenied);
    assert!(query(&core, NOTES).is_empty());
}

#[test]
fn a_lasting_grant_is_used_before_a_once_grant_on_the_same_scope() {
    let home = home("grants-prefer");
    let core = Core::new(roots(&home)).with_prompter(SayYes);
    let once = request(&core, NOTES, notes_read(), "once")["grant"].clone();
    let session = grant(&core, NOTES, notes_read());
    let deliveries = core.events().subscribe_addressed();

    assert!(read_hello(&core, NOTES).is_ok());
    assert_eq!(
        ids(&query(&core, NOTES)),
        vec![once["grantId"].clone(), json!(session)]
    );
    let expired = named(&deliveries, "perm.changed")
        .into_iter()
        .filter(|d| d.data()["change"] == "expired")
        .count();
    assert_eq!(expired, 0);
}

#[test]
fn revoking_an_always_grant_removes_it_from_the_file() {
    let home = home("grants-revoke");
    let (file, core) = stored(&home);
    let id = request(&core, NOTES, notes_read(), "always")["grant"]["grantId"].clone();
    let deliveries = core.events().subscribe_addressed();

    let revoked = call(&core, NOTES, "perm.revoke", json!({ "grantId": id }));
    assert_eq!(revoked.unwrap(), json!({}));
    let changed = named(&deliveries, "perm.changed");
    assert_eq!(changed.len(), 1);
    assert_eq!(
        changed[0].data(),
        &json!({ "grantId": id, "change": "revoked" })
    );
    assert_eq!(changed[0].to, strings(&[NOTES]));
    assert_eq!(file_grants(&file), Vec::<Value>::new());
    assert!(query(&restart(&home, &file), NOTES).is_empty());
}

#[test]
fn grant_ids_stay_unique_across_a_restart() {
    let home = home("grants-ids");
    let (file, core) = stored(&home);
    let first = request(&core, NOTES, notes_read(), "always")["grant"]["grantId"].clone();
    drop(core);

    let second_core = restart(&home, &file);
    let second = request(&second_core, NOTES, notes_read(), "always")["grant"]["grantId"].clone();
    assert_ne!(second, first);
    call(
        &second_core,
        NOTES,
        "perm.revoke",
        json!({ "grantId": first }),
    )
    .unwrap();
    assert_eq!(ids(&query(&second_core, NOTES)), vec![second.clone()]);
    drop(second_core);

    let third_core = restart(&home, &file);
    let third = json!(grant(&third_core, NOTES, notes_read()));
    assert_ne!(third, first);
    assert_ne!(third, second);
    call(
        &third_core,
        NOTES,
        "perm.revoke",
        json!({ "grantId": second }),
    )
    .unwrap();
    assert_eq!(ids(&query(&third_core, NOTES)), vec![third]);
    assert_eq!(file_grants(&file), Vec::<Value>::new());
}

#[test]
fn a_missing_or_unreadable_grant_file_starts_empty() {
    let home = home("grants-garbage");
    let missing = restart(&home, &home.join("nowhere/grants.json"));
    assert!(query(&missing, NOTES).is_empty());

    let file = home.join("grants.json");
    for garbage in [
        "{ not json",
        r#"{ "version": 1, "nextId": 3, "grants": "x" }"#,
    ] {
        fs::write(&file, garbage).unwrap();
        let core = restart(&home, &file);
        assert!(query(&core, NOTES).is_empty());
        let grant = request(&core, NOTES, notes_read(), "always")["grant"].clone();
        assert_eq!(
            file_grants(&file),
            vec![json!({ "caller": NOTES, "grant": grant })]
        );
    }
}

#[test]
fn perm_list_shows_every_callers_grants_to_a_perm_manage_holder() {
    let home = home("grants-list");
    let core = Core::new(roots(&home));
    let notes = grant(&core, NOTES, notes_read());
    let calendar = grant(&core, CALENDAR, calendar_read());
    let list = |params: Value| call(&core, "desk", "perm.list", params);

    let denied = list(json!({ "scope": manage() })).unwrap_err();
    assert_eq!(denied.code, ErrorCode::PermissionDenied);
    assert_eq!(serde_json::to_value(denied.permission).unwrap(), manage());

    let held = grant(&core, "desk", manage());
    let every = list(json!({ "scope": manage() })).unwrap()["grants"].clone();
    let pairs: Vec<(Value, Value)> = every
        .as_array()
        .unwrap()
        .iter()
        .map(|g| (g["caller"].clone(), g["grant"]["grantId"].clone()))
        .collect();
    assert_eq!(
        pairs,
        vec![
            (json!(NOTES), json!(notes)),
            (json!(CALENDAR), json!(calendar)),
            (json!("desk"), json!(held)),
        ]
    );
    assert_eq!(every[0]["grant"]["permission"], notes_read());

    let narrowed = list(json!({ "caller": NOTES, "scope": manage() })).unwrap();
    assert_eq!(narrowed["grants"], json!([every[0]]));
}

#[test]
fn a_perm_manage_holder_revokes_another_callers_grant() {
    let home = home("grants-manage");
    let core = Core::new(roots(&home));
    grant(&core, "desk", manage());
    let notes = grant(&core, NOTES, notes_read());
    let calendar = grant(&core, CALENDAR, calendar_read());
    call(
        &core,
        NOTES,
        "fs.watch",
        json!({ "path": "~/Documents", "recursive": true, "scope": notes_read() }),
    )
    .unwrap();
    assert_eq!(core.watch_count(), 1);
    let deliveries = core.events().subscribe_addressed();
    let revoke = |caller: &str, id: &str| {
        call(
            &core,
            caller,
            "perm.revoke",
            json!({ "grantId": id, "scope": manage() }),
        )
    };

    assert_eq!(revoke("desk", &notes).unwrap(), json!({}));
    let changed = named(&deliveries, "perm.changed");
    assert_eq!(changed.len(), 1);
    assert_eq!(
        changed[0].data(),
        &json!({ "grantId": notes, "change": "revoked" })
    );
    assert_eq!(changed[0].to, strings(&[NOTES]));
    assert_eq!(core.watch_count(), 0);
    let listed = call(&core, "desk", "perm.list", json!({ "scope": manage() })).unwrap();
    let listed: Vec<Value> = listed["grants"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["grant"]["grantId"].clone())
        .collect();
    assert!(!listed.contains(&json!(notes)));
    assert!(listed.contains(&json!(calendar)));

    assert_eq!(
        revoke("desk", "g404").unwrap_err().code,
        ErrorCode::NotFound
    );
    for id in [&calendar, &notes] {
        let denied = revoke(CALENDAR, id).unwrap_err();
        assert_eq!(denied.code, ErrorCode::PermissionDenied);
        assert_eq!(serde_json::to_value(denied.permission).unwrap(), manage());
    }
    assert_eq!(ids(&query(&core, CALENDAR)), vec![json!(calendar)]);
}
