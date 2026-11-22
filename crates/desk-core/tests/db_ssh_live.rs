//! SSH tunnels (ADR 0359) against a real SSH server and a real PostgreSQL reachable only from it.
//! `ENDUE_DB_TEST_SSH` names the SSH server (`ssh://user:password@host:port`, the password the
//! account signs in with), `ENDUE_DB_TEST_SSH_KEY` a private key file it accepts for that user, and
//! `ENDUE_DB_TEST_SSH_POSTGRES` the database as the SSH host reaches it
//! (`postgresql://user:password@host:port/database`). The test skips unless all three are set.

mod support;

use std::sync::Arc;
use std::time::{Duration, Instant};

use desk_core::Core;
use desk_ssh::testing;
use serde_json::{Value, json};
use support::{call, grant, home, roots};

const DATABASE: &str = "example.database";

struct Live {
    ssh: (String, u16, String, String),
    key: String,
    pg: (String, u16, String, String, String),
}

/// `scheme://user:password@host:port[/database]` in parts.
fn parts(uri: &str) -> Option<(String, String, String, u16, String)> {
    let rest = uri.split_once("://")?.1;
    let rest = rest.split_once('?').map_or(rest, |(r, _)| r);
    let (who, place) = rest.rsplit_once('@')?;
    let (user, password) = who.split_once(':').unwrap_or((who, ""));
    let (address, database) = place.split_once('/').unwrap_or((place, ""));
    let (host, port) = address.rsplit_once(':')?;
    Some((
        user.into(),
        password.into(),
        host.into(),
        port.parse().ok()?,
        database.into(),
    ))
}

fn live() -> Option<Live> {
    let var = |name: &str| std::env::var(name).ok().filter(|v| !v.is_empty());
    let (user, password, host, port, _) = parts(&var("ENDUE_DB_TEST_SSH")?)?;
    let (pg_user, pg_password, pg_host, pg_port, database) =
        parts(&var("ENDUE_DB_TEST_SSH_POSTGRES")?)?;
    Some(Live {
        ssh: (host, port, user, password),
        key: var("ENDUE_DB_TEST_SSH_KEY")?,
        pg: (pg_host, pg_port, database, pg_user, pg_password),
    })
}

impl Live {
    fn core(&self, home: &std::path::Path) -> Core {
        let core = Core::new(roots(home)).with_db_ssh_hosts(Some(home.join("db-ssh-hosts.json")));
        grant(&core, DATABASE, self.scope());
        core
    }

    /// db:connect for the database and the SSH host.
    fn scope(&self) -> Value {
        let hosts = [
            format!("{}:{}", self.pg.0, self.pg.1),
            format!("{}:{}", self.ssh.0, self.ssh.1),
        ];
        json!({ "permission": "db:connect", "hosts": hosts })
    }

    fn hop(&self, sign_in: Value) -> Value {
        let (host, port, user, _) = &self.ssh;
        let mut hop = json!({ "host": host, "port": port, "user": user });
        hop.as_object_mut()
            .unwrap()
            .extend(sign_in.as_object().unwrap().clone());
        hop
    }

    fn open(&self, core: &Core, ssh: Value) -> Value {
        let (host, port, database, user, password) = &self.pg;
        let params = json!({ "engine": "postgresql", "host": host, "port": port,
            "database": database, "user": user, "password": password,
            "tls": { "mode": "disable" }, "ssh": ssh,
            "scope": self.scope() });
        call(core, DATABASE, "db.open", params).unwrap()
    }

    /// Open, trusting the key the first answer shows; the session's answer.
    fn trusted(&self, core: &Core, sign_in: Value) -> Value {
        let first = self.open(core, self.hop(sign_in.clone()));
        if first.get("sessionId").is_some() {
            return first;
        }
        assert_eq!(first["ssh"]["hostKey"]["status"], "unknown", "{first}");
        let mut ssh = self.hop(sign_in);
        ssh["hostKey"] = first["ssh"]["hostKey"]["fingerprint"].clone();
        self.open(core, ssh)
    }
}

fn select_one(core: &Core, opened: &Value) {
    let session = &opened["sessionId"];
    assert!(session.is_string(), "{opened}");
    let page = call(
        core,
        DATABASE,
        "db.run",
        json!({ "sessionId": session, "sql": "select 41 + 1" }),
    )
    .unwrap();
    assert_eq!(page["rows"][0][0], "42", "{page}");
    call(core, DATABASE, "db.close", json!({ "sessionId": session })).unwrap();
}

#[test]
fn a_real_server_through_a_real_tunnel() {
    let Some(live) = live() else { return };
    let home = home("db-ssh-live");
    let core = live.core(&home);

    // First use: the fingerprint is shown, nothing signs in until it is accepted.
    let key = json!({ "keyFile": live.key });
    let first = live.open(&core, live.hop(key.clone()));
    let shown = first["ssh"]["hostKey"]["fingerprint"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(shown.starts_with("SHA256:"), "{first}");
    assert_eq!(core.database_count(), 0);

    // A key file signs in and the statement runs on the database behind the SSH host.
    select_one(&core, &live.trusted(&core, key.clone()));
    // Trusted now: no hostKey needed.
    select_one(&core, &live.open(&core, live.hop(key)));

    // A cancel reaches the server through the same tunnel.
    // A second core on the same data folder trusts the key the first kept.
    let shared = Arc::new(live.core(&home));
    let opened = live.open(&shared, live.hop(json!({ "keyFile": live.key })));
    let session = opened["sessionId"].as_str().unwrap().to_owned();
    let (other, id) = (Arc::clone(&shared), session.clone());
    let sleeper = std::thread::spawn(move || {
        let params = json!({ "sessionId": id, "sql": "SELECT pg_sleep(30)" });
        call(&other, DATABASE, "db.run", params).unwrap()
    });
    let running =
        || call(&shared, DATABASE, "db.list", json!({})).unwrap()["sessions"][0]["running"] == true;
    let deadline = Instant::now() + Duration::from_secs(10);
    while !running() {
        assert!(Instant::now() < deadline, "the statement runs");
        std::thread::sleep(Duration::from_millis(20));
    }
    std::thread::sleep(Duration::from_millis(300));
    call(
        &shared,
        DATABASE,
        "db.cancel",
        json!({ "sessionId": session }),
    )
    .unwrap();
    assert_eq!(sleeper.join().unwrap()["error"]["code"], "57014");
    call(
        &shared,
        DATABASE,
        "db.close",
        json!({ "sessionId": session }),
    )
    .unwrap();

    // A password signs in too.
    let password = json!({ "password": live.ssh.3 });
    select_one(&core, &live.open(&core, live.hop(password)));

    // A key the server does not know: auth, the SSH host's, naming the user.
    let stranger = testing::write_key(&home, "stranger", &testing::key(), None);
    let wrong = live.open(&core, live.hop(json!({ "keyFile": stranger })));
    assert_eq!(
        (&wrong["ssh"]["hop"], &wrong["ssh"]["stage"]),
        (&json!("host"), &json!("auth"))
    );
    let message = wrong["ssh"]["message"].as_str().unwrap();
    assert!(
        message.starts_with("The SSH host ") && message.contains(&live.ssh.2),
        "{message}"
    );

    // Another key trusted for the address before: refused, both fingerprints said.
    let at = format!("{}:{}", live.ssh.0, live.ssh.1);
    let before = testing::fingerprint(&testing::key());
    let file = json!({ "version": 1, "hosts": { DATABASE: {
        at: { "algorithm": "ssh-ed25519", "fingerprint": before } } } });
    std::fs::write(home.join("db-ssh-hosts.json"), file.to_string()).unwrap();
    let core = core.with_db_ssh_hosts(Some(home.join("db-ssh-hosts.json")));
    let changed = live.open(&core, live.hop(json!({ "keyFile": live.key })));
    assert_eq!(changed["ssh"]["hostKey"]["status"], "changed", "{changed}");
    assert_eq!(changed["ssh"]["hostKey"]["known"], before.as_str());
    assert_eq!(changed["ssh"]["hostKey"]["fingerprint"], shown.as_str());
    assert_eq!(core.database_count(), 0);
    let _ = std::fs::remove_dir_all(&home);
}
