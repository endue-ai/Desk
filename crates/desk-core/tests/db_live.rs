//! db.* through `Core::handle` against a real server: `ENDUE_DB_TEST_POSTGRES` names it (a
//! `postgresql://user:password@host:port/database` URI); every test skips when it is unset. Pages,
//! fetch, list, cancel, COPY, events to the opener alone, the session's end when its plugin stops or
//! its grant goes, the sixteen-session limit, and the password file under the desk's home.

mod support;

use std::sync::Arc;
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

use desk_bridge::ErrorCode;
use desk_core::{Core, Delivery};
use serde_json::{Value, json};
use support::{call, grant, home, install_hello_declaring, plugin_manage, roots, set_enabled};

const DATABASE: &str = "example.database";

struct Server {
    host: String,
    port: u16,
    database: String,
    user: String,
    password: String,
}

/// The server the URI names, or `None` to skip.
fn server() -> Option<Server> {
    let uri = std::env::var("ENDUE_DB_TEST_POSTGRES")
        .ok()
        .filter(|v| !v.is_empty())?;
    let rest = uri.split_once("://")?.1;
    let rest = rest.split_once('?').map_or(rest, |(r, _)| r);
    let (who, place) = rest.rsplit_once('@')?;
    let (user, password) = who.split_once(':')?;
    let (address, database) = place.split_once('/')?;
    let (host, port) = address.rsplit_once(':')?;
    Some(Server {
        host: host.to_owned(),
        port: port.parse().ok()?,
        database: database.to_owned(),
        user: user.to_owned(),
        password: password.to_owned(),
    })
}

macro_rules! live {
    () => {
        match server() {
            Some(server) => server,
            None => {
                eprintln!("skipped: ENDUE_DB_TEST_POSTGRES is unset");
                return;
            }
        }
    };
}

impl Server {
    fn scope(&self) -> Value {
        json!({ "permission": "db:connect", "hosts": [format!("{}:{}", self.host, self.port)] })
    }

    fn params(&self, password: bool) -> Value {
        let mut params = json!({ "engine": "postgresql", "host": self.host, "port": self.port,
            "database": self.database, "user": self.user, "scope": self.scope() });
        if password {
            params["password"] = json!(self.password);
        }
        params
    }

    /// A session opened as `caller`, granted first.
    fn open(&self, core: &Core, caller: &str) -> String {
        grant(core, caller, self.scope());
        let opened = call(core, caller, "db.open", self.params(true)).unwrap();
        opened["sessionId"].as_str().unwrap().to_owned()
    }
}

fn run(core: &Core, caller: &str, session: &str, sql: &str, extra: Value) -> Value {
    let mut params = json!({ "sessionId": session, "sql": sql });
    for (key, value) in extra.as_object().unwrap() {
        params[key] = value.clone();
    }
    call(core, caller, "db.run", params).unwrap()
}

/// The first event named `name` for `session`, with whom it was addressed to.
fn event(events: &Receiver<Delivery>, name: &str, session: &str) -> (Value, Option<Vec<String>>) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        let Ok(delivery) = events.recv_timeout(left) else {
            break;
        };
        let value = serde_json::to_value(&delivery.event).unwrap();
        if value["event"] == name && value["data"]["sessionId"] == session {
            return (value["data"].clone(), delivery.to);
        }
    }
    panic!("no {name} for {session}");
}

#[test]
fn a_session_opens_runs_in_pages_and_is_listed() {
    let server = live!();
    let core = Core::new(roots(&home("db-live")));
    grant(&core, DATABASE, server.scope());
    let opened = call(&core, DATABASE, "db.open", server.params(true)).unwrap();
    let session = opened["sessionId"].as_str().unwrap();
    assert_eq!(opened["auth"], "scram-sha-256");
    assert!(opened["pid"].as_i64().unwrap() > 0);
    assert_eq!(opened["parameters"]["client_encoding"], "UTF8");

    let sql =
        "SELECT g, NULL::text AS none, '' AS empty, 'NULL' AS word FROM generate_series(1, 2500) g";
    let first = run(&core, DATABASE, session, sql, json!({ "pageRows": 1000 }));
    assert_eq!(
        (first["rows"].as_array().unwrap().len(), &first["more"]),
        (1000, &json!(true))
    );
    assert_eq!(first["rows"][0], json!(["1", null, "", "NULL"]));
    assert_eq!(first["columns"][0]["typeOid"], 23);
    let listed = call(&core, DATABASE, "db.list", json!({})).unwrap();
    let info = &listed["sessions"][0];
    assert_eq!(
        (&info["sessionId"], &info["more"], &info["running"]),
        (&json!(session), &json!(true), &json!(false))
    );
    assert_eq!(
        (&info["database"], &info["pid"]),
        (&json!(server.database), &opened["pid"])
    );
    let fetch = json!({ "sessionId": session, "pageRows": 1000 });
    call(&core, DATABASE, "db.fetch", fetch.clone()).unwrap();
    let last = call(&core, DATABASE, "db.fetch", fetch).unwrap();
    assert_eq!(
        (&last["more"], &last["rowCount"], &last["tag"]),
        (&json!(false), &json!(2500), &json!("SELECT 2500"))
    );
    assert_eq!(last["transaction"], "idle");

    let failed = run(&core, DATABASE, session, "SELECT 1 +", json!({}));
    assert_eq!(
        (&failed["error"]["code"], &failed["error"]["position"]),
        (&json!("42601"), &json!(11))
    );
    let theirs = call(
        &core,
        "example.other",
        "db.run",
        json!({ "sessionId": session, "sql": "SELECT 1" }),
    );
    assert_eq!(theirs.unwrap_err().code, ErrorCode::NotFound);
}

#[test]
fn cancel_reaches_a_running_statement_and_events_reach_the_opener_alone() {
    let server = live!();
    let core = Arc::new(Core::new(roots(&home("db-live"))));
    let events = core.events().subscribe_addressed();
    let session = server.open(&core, DATABASE);
    run(
        &core,
        DATABASE,
        &session,
        "DO $$ BEGIN RAISE NOTICE 'hello'; END $$",
        json!({}),
    );
    let (notice, to) = event(&events, "db.notice", &session);
    assert_eq!(
        (notice["notice"]["message"].as_str(), to),
        (Some("hello"), Some(vec![DATABASE.to_owned()]))
    );

    run(&core, DATABASE, &session, "LISTEN t440_core", json!({}));
    let other = server.open(&core, "example.other");
    run(
        &core,
        "example.other",
        &other,
        "NOTIFY t440_core, 'ping'",
        json!({}),
    );
    let (notified, to) = event(&events, "db.notification", &session);
    assert_eq!(
        (notified["payload"].as_str(), to),
        (Some("ping"), Some(vec![DATABASE.to_owned()]))
    );

    let (core2, id) = (core.clone(), session.clone());
    let sleeper =
        std::thread::spawn(move || run(&core2, DATABASE, &id, "SELECT pg_sleep(30)", json!({})));
    let running =
        || call(&core, DATABASE, "db.list", json!({})).unwrap()["sessions"][0]["running"] == true;
    let deadline = Instant::now() + Duration::from_secs(10);
    while !running() {
        assert!(Instant::now() < deadline, "the statement runs");
        std::thread::sleep(Duration::from_millis(20));
    }
    std::thread::sleep(Duration::from_millis(300));
    let busy = call(
        &core,
        DATABASE,
        "db.run",
        json!({ "sessionId": session, "sql": "SELECT 1" }),
    );
    assert_eq!(busy.unwrap_err().code, ErrorCode::InvalidParams);
    call(
        &core,
        DATABASE,
        "db.cancel",
        json!({ "sessionId": session }),
    )
    .unwrap();
    assert_eq!(sleeper.join().unwrap()["error"]["code"], "57014");
}

#[test]
fn copy_in_and_out_cross_the_bridge() {
    let server = live!();
    let core = Core::new(roots(&home("db-live")));
    let session = server.open(&core, DATABASE);
    run(
        &core,
        DATABASE,
        &session,
        "CREATE TEMP TABLE k (id int, name text)",
        json!({}),
    );
    let started = run(&core, DATABASE, &session, "COPY k FROM STDIN", json!({}));
    assert_eq!(
        (&started["copy"]["direction"], &started["more"]),
        (&json!("in"), &json!(true))
    );
    let chunk = json!({ "sessionId": session, "data": "1\tada\n" });
    assert_eq!(
        call(&core, DATABASE, "db.copy", chunk).unwrap()["more"],
        true
    );
    // "2\tbob\n", base64.
    let last =
        json!({ "sessionId": session, "data": "Mglib2IK", "encoding": "base64", "done": true });
    assert_eq!(
        call(&core, DATABASE, "db.copy", last).unwrap()["tag"],
        "COPY 2"
    );
    let out = run(&core, DATABASE, &session, "COPY k TO STDOUT", json!({}));
    assert_eq!(
        (&out["data"], &out["encoding"]),
        (&json!("1\tada\n2\tbob\n"), &json!("utf8"))
    );
}

#[test]
fn sessions_end_when_the_grant_goes_or_the_plugin_stops() {
    let server = live!();
    let home = home("db-live");
    let core = Core::new(roots(&home));
    let events = core.events().subscribe_addressed();
    let grant_id = grant(&core, DATABASE, server.scope());
    let opened = call(&core, DATABASE, "db.open", server.params(true)).unwrap();
    let session = opened["sessionId"].as_str().unwrap().to_owned();
    call(
        &core,
        DATABASE,
        "perm.revoke",
        json!({ "grantId": grant_id }),
    )
    .unwrap();
    assert_eq!(event(&events, "db.closed", &session).0["reason"], "revoked");
    assert_eq!(core.database_count(), 0);

    let declared = json!([{ "permission": "db:connect", "hosts": ["*"] }]);
    install_hello_declaring(&core, &home, declared);
    grant(&core, "desk", plugin_manage());
    let theirs = server.open(&core, "example.hello");
    set_enabled(&core, "example.hello", false);
    assert_eq!(event(&events, "db.closed", &theirs).0["reason"], "unloaded");

    let closing = server.open(&core, DATABASE);
    call(&core, DATABASE, "db.close", json!({ "sessionId": closing })).unwrap();
    assert_eq!(event(&events, "db.closed", &closing).0["reason"], "closed");
    call(&core, DATABASE, "db.close", json!({ "sessionId": closing })).unwrap();
}

#[test]
fn a_caller_holds_sixteen_sessions() {
    let server = live!();
    let core = Core::new(roots(&home("db-live")));
    let sessions: Vec<String> = (0..16).map(|_| server.open(&core, DATABASE)).collect();
    let seventeenth = call(&core, DATABASE, "db.open", server.params(true)).unwrap_err();
    assert_eq!(seventeenth.code, ErrorCode::InvalidValue);
    call(
        &core,
        DATABASE,
        "db.close",
        json!({ "sessionId": sessions[0] }),
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while core.database_count() > 15 {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(20));
    }
    server.open(&core, DATABASE);
}

#[test]
fn the_password_file_under_the_desks_home_answers_a_missing_password() {
    let server = live!();
    if std::env::var_os("PGPASSFILE").is_some() {
        eprintln!("skipped: PGPASSFILE names another password file");
        return;
    }
    let home = home("db-live");
    let core = Core::new(roots(&home));
    grant(&core, DATABASE, server.scope());
    let asked = call(&core, DATABASE, "db.open", server.params(false)).unwrap();
    assert_eq!(asked, json!({ "needsPassword": true }));
    let file = home.join(".pgpass");
    let line = format!(
        "{}:{}:*:{}:{}\n",
        server.host, server.port, server.user, server.password
    );
    std::fs::write(&file, line).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let opened = call(&core, DATABASE, "db.open", server.params(false)).unwrap();
    assert!(opened["sessionId"].is_string(), "{opened}");
}
