//! A call's notices as they are raised, through `Core` against a real server (PG-25, ADR 0358):
//! each comes as `db.call.notice` to the session's caller alone, before the `db.run` answer, with
//! the call number that answer carries. `ENDUE_DB_TEST_POSTGRES` names the server; the test skips
//! when it is unset.

mod support;

use std::sync::Arc;
use std::time::{Duration, Instant};

use desk_core::Core;
use serde_json::{Value, json};
use support::{call, grant, home, roots};

const DATABASE: &str = "example.database";

/// db.open's params for the URI's server, and its db:connect scope; `None` to skip.
fn server() -> Option<(Value, Value)> {
    let uri = std::env::var("ENDUE_DB_TEST_POSTGRES")
        .ok()
        .filter(|v| !v.is_empty())?;
    let rest = uri.split_once("://")?.1;
    let rest = rest.split_once('?').map_or(rest, |(r, _)| r);
    let (who, place) = rest.rsplit_once('@')?;
    let (user, password) = who.split_once(':')?;
    let (address, database) = place.split_once('/')?;
    let (host, port) = address.rsplit_once(':')?;
    let port: u16 = port.parse().ok()?;
    let scope = json!({ "permission": "db:connect", "hosts": [format!("{host}:{port}")] });
    let params = json!({ "engine": "postgresql", "host": host, "port": port, "database": database,
        "user": user, "password": password, "scope": scope });
    Some((params, scope))
}

#[test]
fn db_call_notice_reaches_the_caller_while_db_run_runs() {
    let Some((params, scope)) = server() else {
        eprintln!("skipped: ENDUE_DB_TEST_POSTGRES is unset");
        return;
    };
    let core = Arc::new(Core::new(roots(&home("db-live-raised"))));
    let events = core.events().subscribe_addressed();
    grant(&core, DATABASE, scope);
    let opened = call(&core, DATABASE, "db.open", params).unwrap();
    let session = opened["sessionId"].as_str().unwrap().to_owned();
    let (core2, id) = (core.clone(), session.clone());
    let sql = "DO $$ BEGIN RAISE NOTICE 'first'; RAISE NOTICE 'second'; PERFORM pg_sleep(1.5); END $$";
    let running = std::thread::spawn(move || {
        call(&core2, DATABASE, "db.run", json!({ "sessionId": id, "sql": sql })).unwrap()
    });

    let mut heard = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(10);
    while heard.len() < 2 {
        let left = deadline.checked_duration_since(Instant::now()).expect("both came");
        let Ok(delivery) = events.recv_timeout(left) else {
            continue;
        };
        let value = serde_json::to_value(&delivery.event).unwrap();
        if value["event"] == "db.call.notice" && value["data"]["sessionId"] == session.as_str() {
            assert_eq!(delivery.to, Some(vec![DATABASE.to_owned()]), "its caller alone");
            heard.push(value["data"].clone());
        }
    }
    assert!(!running.is_finished(), "they came before the answer");
    let page = running.join().unwrap();
    let texts: Vec<&str> = heard.iter().map(|d| d["notice"]["message"].as_str().unwrap()).collect();
    assert_eq!(texts, ["first", "second"]);
    assert!(page["call"].as_u64().is_some_and(|call| call >= 1));
    for data in &heard {
        assert_eq!(data["call"], page["call"], "the call whose answer carries it");
    }
    assert_eq!(page["notices"].as_array().map(Vec::len), Some(2), "the page is the record");
}
