//! db.open through an SSH tunnel (ADR 0359), against an SSH server in the test process and a
//! PostgreSQL stand-in behind it that signs anyone in: db:connect is checked for every hop before
//! anything connects, a host key not trusted yet answers its fingerprint, an accepted one is kept
//! per plugin in `db-ssh-hosts.json` and a changed one is refused until db.hostKeys.delete, a kept
//! SSH password is used by `passwordRef`, failures name their hop, agents are refused, and the
//! tunnel closes with the session.

mod support;

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;

use desk_bridge::{BridgeError, ErrorCode};
use desk_core::Core;
use desk_ssh::testing::{self, Account, Server};
use desk_sys::keychain::Keychain;
use desk_sys::keychain::fake::FakeKeychain;
use serde_json::{Value, json};
use support::{call, grant, home, roots};

const DATABASE: &str = "example.database";

/// A server that signs every startup in (AuthenticationOk, BackendKeyData, ReadyForQuery) and
/// counts its connections.
fn postgres() -> (u16, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let count = Arc::new(AtomicUsize::new(0));
    let counted = count.clone();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            counted.fetch_add(1, Ordering::SeqCst);
            thread::spawn(move || serve(stream));
        }
    });
    (port, count)
}

fn serve(mut stream: TcpStream) {
    let mut len = [0u8; 4];
    if stream.read_exact(&mut len).is_err() {
        return;
    }
    let mut body = vec![0u8; (u32::from_be_bytes(len) as usize).saturating_sub(4)];
    if stream.read_exact(&mut body).is_err() {
        return;
    }
    let mut ok = vec![b'R', 0, 0, 0, 8, 0, 0, 0, 0];
    ok.extend([b'K', 0, 0, 0, 12, 0, 0, 0x10, 0, 0, 0, 0, 7]);
    ok.extend([b'Z', 0, 0, 0, 5, b'I']);
    let _ = stream.write_all(&ok);
    let _ = stream.read_to_end(&mut Vec::new());
}

fn ssh_server() -> Server {
    let account = Account {
        user: "deploy".to_owned(),
        password: Some("fixture-ssh-password".to_owned()),
        keys: Vec::new(),
    };
    Server::start(testing::key(), account)
}

fn open(core: &Core, caller: &str, pg: u16, ssh: Value) -> Result<Value, BridgeError> {
    let params = json!({ "engine": "postgresql", "host": "127.0.0.1", "port": pg,
        "database": "shop", "user": "reader", "tls": { "mode": "disable" }, "ssh": ssh,
        "scope": { "permission": "db:connect", "hosts": ["127.0.0.1"] } });
    call(core, caller, "db.open", params)
}

fn core(home: &Path) -> Core {
    let core = Core::new(roots(home)).with_db_ssh_hosts(Some(home.join("db-ssh-hosts.json")));
    grant(
        &core,
        DATABASE,
        json!({ "permission": "db:connect", "hosts": ["127.0.0.1"] }),
    );
    core
}

fn by_password(server: &Server) -> Value {
    json!({ "host": "127.0.0.1", "port": server.port, "user": "deploy",
        "password": "fixture-ssh-password" })
}

#[test]
fn every_hop_is_checked_against_the_grant_before_anything_connects() {
    let home = home("db-ssh-grant");
    let core = Core::new(roots(&home));
    let server = ssh_server();
    let (pg, connections) = postgres();
    grant(
        &core,
        DATABASE,
        json!({ "permission": "db:connect", "hosts": [format!("127.0.0.1:{pg}")] }),
    );
    let refused = open(&core, DATABASE, pg, by_password(&server)).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied, "{refused:?}");
    assert_eq!((server.seen(), connections.load(Ordering::SeqCst)), (0, 0));
    assert_eq!(core.database_count(), 0);

    let agent = call(
        &core,
        "agent:helper",
        "db.hostKeys.delete",
        json!({ "host": "127.0.0.1" }),
    );
    assert_eq!(agent.unwrap_err().code, ErrorCode::PermissionDenied);
    let agent = open(&core, "agent:helper", pg, by_password(&server)).unwrap_err();
    assert_eq!(agent.code, ErrorCode::PermissionDenied);
}

#[test]
fn a_host_key_is_trusted_on_first_use_and_a_changed_one_is_refused() {
    let home = home("db-ssh-trust");
    let core = core(&home);
    let server = ssh_server();
    let (pg, connections) = postgres();
    let fingerprint = testing::fingerprint(&server.host_key);

    let unknown = open(&core, DATABASE, pg, by_password(&server)).unwrap();
    assert_eq!(unknown["ssh"]["hop"], "host");
    assert_eq!(unknown["ssh"]["stage"], "hostKey");
    assert_eq!(unknown["ssh"]["hostKey"]["status"], "unknown");
    assert_eq!(
        unknown["ssh"]["hostKey"]["fingerprint"],
        fingerprint.as_str()
    );
    assert!(unknown.get("sessionId").is_none());
    assert_eq!(connections.load(Ordering::SeqCst), 0);

    let mut accepted = by_password(&server);
    accepted["hostKey"] = json!(fingerprint);
    let opened = open(&core, DATABASE, pg, accepted).unwrap();
    let session = opened["sessionId"].as_str().expect("a session").to_owned();
    assert_eq!(
        (server.forwarded(), connections.load(Ordering::SeqCst)),
        (1, 1)
    );
    let kept = std::fs::read_to_string(home.join("db-ssh-hosts.json")).unwrap();
    assert!(
        kept.contains(&fingerprint) && kept.contains(DATABASE),
        "{kept}"
    );
    assert!(!kept.contains("fixture-ssh-password"), "{kept}");

    // The tunnel closes with the session.
    call(&core, DATABASE, "db.close", json!({ "sessionId": session })).unwrap();
    assert!(server.wait_live(0), "the tunnel outlived its session");

    // Trusted now: no hostKey needed. Another plugin trusts nothing yet.
    let again = open(&core, DATABASE, pg, by_password(&server)).unwrap();
    assert!(again["sessionId"].is_string(), "{again}");
    grant(
        &core,
        "example.other",
        json!({ "permission": "db:connect", "hosts": ["127.0.0.1"] }),
    );
    let other = open(&core, "example.other", pg, by_password(&server)).unwrap();
    assert_eq!(other["ssh"]["hostKey"]["status"], "unknown");

    // Forgotten, the key is asked for again.
    let params = json!({ "host": "127.0.0.1", "port": server.port });
    call(&core, DATABASE, "db.hostKeys.delete", params).unwrap();
    let kept = std::fs::read_to_string(home.join("db-ssh-hosts.json")).unwrap();
    assert!(!kept.contains(&fingerprint), "{kept}");
    let asked = open(&core, DATABASE, pg, by_password(&server)).unwrap();
    assert_eq!(asked["ssh"]["hostKey"]["status"], "unknown");
}

#[test]
fn a_changed_host_key_is_refused_until_it_is_forgotten() {
    let home = home("db-ssh-changed");
    let core = core(&home);
    let server = ssh_server();
    let (pg, _) = postgres();
    // What a run before trusted for this address: another key.
    let before = testing::fingerprint(&testing::key());
    let file = json!({ "version": 1, "hosts": { DATABASE: {
        format!("127.0.0.1:{}", server.port): { "algorithm": "ssh-ed25519", "fingerprint": before } } } });
    std::fs::write(home.join("db-ssh-hosts.json"), file.to_string()).unwrap();
    let core = core.with_db_ssh_hosts(Some(home.join("db-ssh-hosts.json")));

    let mut ssh = by_password(&server);
    ssh["hostKey"] = json!(testing::fingerprint(&server.host_key));
    let changed = open(&core, DATABASE, pg, ssh.clone()).unwrap();
    assert_eq!(changed["ssh"]["stage"], "hostKey");
    assert_eq!(changed["ssh"]["hostKey"]["status"], "changed");
    assert_eq!(changed["ssh"]["hostKey"]["known"], before.as_str());
    let message = changed["ssh"]["message"].as_str().unwrap();
    assert!(
        message.starts_with("The SSH host 127.0.0.1:") && message.contains("refused"),
        "{message}"
    );

    let params = json!({ "host": "127.0.0.1", "port": server.port });
    call(&core, DATABASE, "db.hostKeys.delete", params).unwrap();
    assert!(open(&core, DATABASE, pg, ssh).unwrap()["sessionId"].is_string());
}

#[test]
fn failures_name_their_hop_and_a_kept_password_signs_in() {
    let home = home("db-ssh-hops");
    let keychain = Arc::new(FakeKeychain::default());
    let core = core(&home).with_db_passwords(
        Some(Arc::clone(&keychain) as Arc<dyn Keychain>),
        Some(home.join("db-passwords.json")),
    );
    let server = ssh_server();
    let (pg, _) = postgres();
    let trusted = |mut ssh: Value| {
        ssh["hostKey"] = json!(testing::fingerprint(&server.host_key));
        ssh
    };

    let mut wrong = trusted(by_password(&server));
    wrong["password"] = json!("not it");
    let refused = open(&core, DATABASE, pg, wrong).unwrap();
    assert_eq!(
        (&refused["ssh"]["hop"], &refused["ssh"]["stage"]),
        (&json!("host"), &json!("auth"))
    );
    let message = refused["ssh"]["message"].as_str().unwrap();
    assert!(
        message.contains("refused the password for deploy"),
        "{message}"
    );
    assert!(!refused.to_string().contains("not it"), "{refused}");

    let by_ref = trusted(
        json!({ "host": "127.0.0.1", "port": server.port, "user": "deploy",
        "passwordRef": "bastion" }),
    );
    let missing = open(&core, DATABASE, pg, by_ref.clone()).unwrap();
    assert_eq!(missing["ssh"]["needsPassword"], true);
    let kept = json!({ "name": "bastion", "host": "127.0.0.1", "port": server.port,
        "user": "deploy", "password": "fixture-ssh-password" });
    call(&core, DATABASE, "db.passwords.set", kept).unwrap();
    let signed = open(&core, DATABASE, pg, by_ref).unwrap();
    call(
        &core,
        DATABASE,
        "db.close",
        json!({ "sessionId": signed["sessionId"] }),
    )
    .unwrap();

    // The SSH host cannot reach the database: forward, naming both.
    let closed = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let unreachable = open(&core, DATABASE, closed, trusted(by_password(&server))).unwrap();
    assert_eq!(unreachable["ssh"]["stage"], "forward");
    let message = unreachable["ssh"]["message"].as_str().unwrap();
    assert!(
        message.contains(&format!("could not reach 127.0.0.1:{closed}")),
        "{message}"
    );

    // Nobody at the jump host: connect, the jump host's.
    let mut jumped = trusted(by_password(&server));
    jumped["jump"] =
        json!({ "host": "127.0.0.1", "port": closed, "user": "deploy", "agent": true });
    let unreachable = open(&core, DATABASE, pg, jumped).unwrap();
    assert_eq!(
        (&unreachable["ssh"]["hop"], &unreachable["ssh"]["stage"]),
        (&json!("jump"), &json!("connect"))
    );

    let both = json!({ "host": "127.0.0.1", "port": server.port, "user": "deploy",
        "password": "x", "agent": true });
    let invalid = open(&core, DATABASE, pg, both).unwrap_err();
    assert_eq!(invalid.code, ErrorCode::InvalidParams, "{invalid:?}");
    let relative = json!({ "host": "127.0.0.1", "port": server.port, "user": "deploy",
        "keyFile": "keys/id_ed25519" });
    assert_eq!(
        open(&core, DATABASE, pg, relative).unwrap_err().code,
        ErrorCode::InvalidParams
    );
    let encrypted = trusted(
        json!({ "host": "127.0.0.1", "port": server.port, "user": "deploy",
        "keyFile": write_encrypted(&home) }),
    );
    let needed = open(&core, DATABASE, pg, encrypted).unwrap();
    assert_eq!(needed["ssh"]["keyPassword"], "needed");
    assert_eq!(core.database_count(), 0);
}

fn write_encrypted(home: &Path) -> String {
    let path = testing::write_key(
        home,
        "id_ed25519",
        &testing::key(),
        Some("fixture passphrase"),
    );
    path.to_string_lossy().into_owned()
}
