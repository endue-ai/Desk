//! How db.* sessions end through `Core` against a real server (ADR 0339): `db.close`, a plugin that
//! stops and the desk's quit each cancel a running statement before Terminate, so the server holds
//! nothing of the session after. `ENDUE_DB_TEST_POSTGRES` names the server; every test skips when
//! it is unset.

mod support;

use std::sync::Arc;
use std::sync::mpsc::Receiver;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use desk_core::{Core, Delivery};
use serde_json::{Value, json};
use support::{call, grant, home, install_hello_declaring, plugin_manage, roots, set_enabled};

const DATABASE: &str = "example.database";
const HELLO: &str = "example.hello";

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

    /// A session opened as `caller`, granted first: its id and backend pid.
    fn open(&self, core: &Core, caller: &str) -> (String, i64) {
        grant(core, caller, self.scope());
        let params = json!({ "engine": "postgresql", "host": self.host, "port": self.port,
            "database": self.database, "user": self.user, "password": self.password,
            "scope": self.scope() });
        let opened = call(core, caller, "db.open", params).unwrap();
        let id = opened["sessionId"].as_str().unwrap().to_owned();
        (id, opened["pid"].as_i64().unwrap())
    }
}

/// `pg_sleep(30)` on the session, on a thread of its own, once the core says it runs.
fn sleeping(core: &Arc<Core>, caller: &str, session: &str) -> JoinHandle<Result<Value, String>> {
    let (core2, caller2, id) = (core.clone(), caller.to_owned(), session.to_owned());
    let sleeper = std::thread::spawn(move || {
        let params = json!({ "sessionId": id, "sql": "SELECT pg_sleep(30)" });
        call(&core2, &caller2, "db.run", params).map_err(|e| e.message)
    });
    let running = || {
        let listed = call(core, caller, "db.list", json!({})).unwrap();
        listed["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["sessionId"] == session && s["running"] == true)
    };
    let deadline = Instant::now() + Duration::from_secs(10);
    while !running() {
        assert!(Instant::now() < deadline, "the statement runs");
        std::thread::sleep(Duration::from_millis(20));
    }
    std::thread::sleep(Duration::from_millis(300));
    sleeper
}

/// The reason of `session`'s db.closed.
fn closed(events: &Receiver<Delivery>, session: &str) -> String {
    let deadline = Instant::now() + Duration::from_secs(10);
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        let Ok(delivery) = events.recv_timeout(left) else {
            break;
        };
        let value = serde_json::to_value(&delivery.event).unwrap();
        if value["event"] == "db.closed" && value["data"]["sessionId"] == session {
            return value["data"]["reason"]
                .as_str()
                .unwrap_or_default()
                .to_owned();
        }
    }
    panic!("no db.closed for {session}");
}

/// Whether the server lets go of every backend in `pids` within five seconds, asked by `core`.
fn gone(server: &Server, pids: &[i64]) -> bool {
    let watcher = Core::new(roots(&home("db-end-watch")));
    let (id, _) = server.open(&watcher, "example.watcher");
    let list = pids
        .iter()
        .map(i64::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!("SELECT count(*) FROM pg_stat_activity WHERE pid IN ({list})");
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let page = call(
            &watcher,
            "example.watcher",
            "db.run",
            json!({ "sessionId": id, "sql": sql }),
        );
        if page.unwrap()["rows"][0][0] == "0" {
            return true;
        }
        if Instant::now() > deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn db_close_cancels_a_running_statement() {
    let server = live!();
    let core = Arc::new(Core::new(roots(&home("db-end"))));
    let events = core.events().subscribe_addressed();
    let (session, pid) = server.open(&core, DATABASE);
    let sleeper = sleeping(&core, DATABASE, &session);
    call(&core, DATABASE, "db.close", json!({ "sessionId": session })).unwrap();
    assert!(
        sleeper.join().unwrap().is_err(),
        "the waiting run is answered"
    );
    assert_eq!(closed(&events, &session), "closed");
    assert!(gone(&server, &[pid]), "the statement ran on after db.close");
}

#[test]
fn an_unloaded_plugin_leaves_no_running_statement() {
    let server = live!();
    let home = home("db-end");
    let core = Arc::new(Core::new(roots(&home)));
    let events = core.events().subscribe_addressed();
    let declared = json!([{ "permission": "db:connect", "hosts": ["*"] }]);
    install_hello_declaring(&core, &home, declared);
    grant(&core, "desk", plugin_manage());
    let (session, pid) = server.open(&core, HELLO);
    let sleeper = sleeping(&core, HELLO, &session);
    set_enabled(&core, HELLO, false);
    assert!(sleeper.join().unwrap().is_err());
    assert_eq!(closed(&events, &session), "unloaded");
    assert_eq!(core.database_count(), 0);
    assert!(
        gone(&server, &[pid]),
        "the statement ran on after its plugin stopped"
    );
}

#[test]
fn quitting_ends_every_session_and_its_statement() {
    let server = live!();
    let core = Arc::new(Core::new(roots(&home("db-end"))));
    let events = core.events().subscribe_addressed();
    let (busy, busy_pid) = server.open(&core, DATABASE);
    let (idle, idle_pid) = server.open(&core, "example.other");
    let sleeper = sleeping(&core, DATABASE, &busy);
    let start = Instant::now();
    let left = core.quit_databases(Duration::from_secs(5));
    assert_eq!(left, 0, "every session ended within the bound");
    assert!(
        start.elapsed() < Duration::from_secs(5),
        "{:?}",
        start.elapsed()
    );
    assert_eq!(core.database_count(), 0);
    assert!(sleeper.join().unwrap().is_err());
    assert_eq!(closed(&events, &busy), "desk");
    assert_eq!(closed(&events, &idle), "desk");
    assert!(
        gone(&server, &[busy_pid, idle_pid]),
        "a session outlived the quit"
    );
}
