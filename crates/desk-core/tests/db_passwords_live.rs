//! Kept passwords (ADR 0311) against what a unit test cannot reach. `ENDUE_DB_TEST_POSTGRES` names
//! a real server (a `postgresql://user:password@host:port/database` URI): a kept password signs in
//! to it by `passwordRef`, and a wrong one is the server's refusal. `ENDUE_KEYCHAIN_TEST=1` on macOS
//! lets a test write the login Keychain, under the throwaway service `ai.endue.desk.test` and a name
//! of its own, and delete it again. Each test skips when its variable is unset.

mod support;

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use desk_core::Core;
use desk_sys::keychain::Keychain;
use desk_sys::keychain::fake::FakeKeychain;
use serde_json::{Value, json};
use support::{call, grant, home, roots};

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

impl Server {
    fn scope(&self) -> Value {
        json!({ "permission": "db:connect", "hosts": [format!("{}:{}", self.host, self.port)] })
    }

    fn keep(&self, core: &Core, name: &str, password: &str) {
        let params = json!({ "name": name, "host": self.host, "port": self.port,
            "user": self.user, "password": password });
        call(core, DATABASE, "db.passwords.set", params).unwrap();
    }

    fn open(&self, core: &Core, name: &str) -> Value {
        let params = json!({ "engine": "postgresql", "host": self.host, "port": self.port,
            "database": self.database, "user": self.user, "passwordRef": name,
            "scope": self.scope() });
        call(core, DATABASE, "db.open", params).unwrap()
    }
}

fn core(keychain: Arc<dyn Keychain>) -> Core {
    let home = home("db-passwords-live");
    Core::new(roots(&home)).with_db_passwords(Some(keychain), None)
}

/// A name no other run uses.
fn throwaway() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("t443-{}-{nanos}", std::process::id())
}

#[test]
fn a_kept_password_signs_in_to_a_real_server() {
    let Some(server) = server() else {
        eprintln!("skipped: ENDUE_DB_TEST_POSTGRES is unset");
        return;
    };
    let core = core(Arc::new(FakeKeychain::new()));
    grant(&core, DATABASE, server.scope());
    server.keep(&core, "c-live", &server.password);
    let opened = server.open(&core, "c-live");
    let session = opened["sessionId"].as_str().expect("a session").to_owned();
    assert!(!opened.to_string().contains(&server.password));
    let run = json!({ "sessionId": session, "sql": "SELECT current_user" });
    let page = call(&core, DATABASE, "db.run", run).unwrap();
    assert_eq!(page["rows"], json!([[server.user]]));
    call(&core, DATABASE, "db.close", json!({ "sessionId": session })).unwrap();

    server.keep(&core, "c-live", "not-the-password");
    let refused = server.open(&core, "c-live");
    assert_eq!(refused["error"]["code"], "28P01", "{refused}");
}

#[test]
fn the_os_keychain_keeps_uses_and_forgets_a_database_password() {
    let wanted = std::env::var("ENDUE_KEYCHAIN_TEST").is_ok_and(|v| v == "1");
    if !(wanted && cfg!(target_os = "macos")) {
        eprintln!("skipped: ENDUE_KEYCHAIN_TEST=1 on macOS reaches the login Keychain");
        return;
    }
    let service = "ai.endue.desk.test";
    let os: Arc<dyn Keychain> = Arc::new(desk_sys::keychain::os(service).unwrap());
    let core = core(Arc::clone(&os));
    let name = throwaway();
    let account = format!("db/{DATABASE}/{name}");
    let params = json!({ "name": name, "host": "127.0.0.1", "port": 5432, "user": "reader",
        "password": "throwaway-password" });
    call(&core, DATABASE, "db.passwords.set", params).unwrap();
    let kept = os
        .get(&account)
        .unwrap()
        .expect("the entry in the login Keychain");
    assert!(kept.contains("throwaway-password") && kept.contains("127.0.0.1"));
    let listed = call(&core, DATABASE, "db.passwords.list", json!({})).unwrap();
    assert_eq!(listed["passwords"][0]["name"], name.as_str());
    if let Some(server) = server() {
        grant(&core, DATABASE, server.scope());
        server.keep(&core, &name, &server.password);
        let opened = server.open(&core, &name);
        assert!(opened["sessionId"].is_string(), "{opened}");
    }
    call(
        &core,
        DATABASE,
        "db.passwords.delete",
        json!({ "name": name }),
    )
    .unwrap();
    assert_eq!(os.get(&account).unwrap(), None);
}
