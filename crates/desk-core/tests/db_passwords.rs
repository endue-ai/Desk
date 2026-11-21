//! Passwords kept in the OS keychain for `db.open` (ADR 0311), through `Core::handle` with a fake
//! keychain: kept by name for one host, port and user, listed without the password, used by
//! `passwordRef` only for that server and after the password file, forgotten by name and with the
//! plugin, refused to agents and to plugins that do not declare `db:connect`, `unsupported` without a
//! keychain, and no answer holding the password. The server is an in-process `TcpListener` on
//! 127.0.0.1 that asks for an md5 password with a fixed salt and reports the proof it was sent, so a
//! test sees which password signed in without reading it back. No test touches the person's keychain.

mod support;

use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::Duration;

use desk_bridge::{BridgeError, ErrorCode};
use desk_core::Core;
use desk_sys::keychain::Keychain;
use desk_sys::keychain::fake::FakeKeychain;
use serde_json::{Value, json};
use support::{call, grant, home, install_hello_declaring, roots};

const DATABASE: &str = "example.database";
const PASSWORD: &str = "fixture-keychain-password";

/// A server that asks every connection for an md5 password and lets it in once it has one.
struct Md5Server {
    port: u16,
    proofs: Receiver<String>,
}

impl Md5Server {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (sent, proofs) = mpsc::channel();
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let sent = sent.clone();
                thread::spawn(move || serve(stream, &sent));
            }
        });
        Self { port, proofs }
    }

    /// The proof the last sign-in sent, or `None` when none came.
    fn proof(&self) -> Option<String> {
        self.proofs.recv_timeout(Duration::from_millis(500)).ok()
    }
}

fn serve(mut stream: TcpStream, sent: &Sender<String>) {
    let Some(_startup) = frame(&mut stream, None) else {
        return;
    };
    // AuthenticationMD5Password, salt 1 2 3 4.
    let _ = stream.write_all(&[b'R', 0, 0, 0, 12, 0, 0, 0, 5, 1, 2, 3, 4]);
    let Some(proof) = frame(&mut stream, Some(b'p')) else {
        return;
    };
    let _ = sent.send(String::from_utf8_lossy(&proof).trim_end_matches('\0').to_owned());
    // AuthenticationOk, BackendKeyData, ReadyForQuery (idle).
    let mut ok = vec![b'R', 0, 0, 0, 8, 0, 0, 0, 0];
    ok.extend([b'K', 0, 0, 0, 12, 0, 0, 0x10, 0, 0, 0, 0, 7]);
    ok.extend([b'Z', 0, 0, 0, 5, b'I']);
    let _ = stream.write_all(&ok);
    let _ = stream.read_to_end(&mut Vec::new());
}

/// One message's body: with a tag byte first, or the untagged startup message.
fn frame(stream: &mut TcpStream, tag: Option<u8>) -> Option<Vec<u8>> {
    if let Some(tag) = tag {
        let mut got = [0u8; 1];
        stream.read_exact(&mut got).ok()?;
        (got[0] == tag).then_some(())?;
    }
    let mut len = [0u8; 4];
    stream.read_exact(&mut len).ok()?;
    let mut body = vec![0u8; (u32::from_be_bytes(len) as usize).checked_sub(4)?];
    stream.read_exact(&mut body).ok()?;
    Some(body)
}

fn scope() -> Value {
    json!({ "permission": "db:connect", "hosts": ["127.0.0.1"] })
}

fn core_with(keychain: &Arc<FakeKeychain>, home: &Path) -> Core {
    let keychain = Arc::clone(keychain) as Arc<dyn Keychain>;
    Core::new(roots(home)).with_db_passwords(Some(keychain), Some(home.join("db-passwords.json")))
}

fn keep(core: &Core, caller: &str, name: &str, port: u16, user: &str, password: &str) -> Value {
    let params = json!({ "name": name, "host": "127.0.0.1", "port": port, "user": user,
        "password": password });
    call(core, caller, "db.passwords.set", params).unwrap()
}

fn open(core: &Core, caller: &str, port: u16, extra: Value) -> Result<Value, BridgeError> {
    let mut params = json!({ "engine": "postgresql", "host": "127.0.0.1", "port": port,
        "database": "shop", "user": "reader", "tls": { "mode": "disable" }, "scope": scope() });
    for (key, value) in extra.as_object().unwrap() {
        params[key] = value.clone();
    }
    call(core, caller, "db.open", params)
}

fn listed(core: &Core, caller: &str) -> Value {
    call(core, caller, "db.passwords.list", json!({})).unwrap()
}

#[test]
fn a_kept_password_is_listed_by_name_and_no_answer_holds_it() {
    let home = home("db-passwords");
    let keychain = Arc::new(FakeKeychain::new());
    let core = core_with(&keychain, &home);
    let mut answers = vec![keep(&core, DATABASE, "c-1", 5432, "reader", PASSWORD)];
    assert_eq!(answers[0], json!({}));
    let list = listed(&core, DATABASE);
    assert_eq!(
        list,
        json!({ "passwords": [{ "name": "c-1", "host": "127.0.0.1", "port": 5432, "user": "reader" }] })
    );
    answers.push(list);
    let kept = keychain.secrets();
    assert_eq!(kept.keys().collect::<Vec<_>>(), ["db/example.database/c-1"]);
    let secret: Value = serde_json::from_str(&kept["db/example.database/c-1"]).unwrap();
    assert_eq!(
        secret,
        json!({ "host": "127.0.0.1", "port": 5432, "user": "reader", "password": PASSWORD })
    );
    answers.push(keep(&core, DATABASE, "c-1", 5432, "reader", "replaced-password"));
    assert_eq!(keychain.secrets().len(), 1, "the same name replaces it");
    answers.push(call(&core, DATABASE, "db.passwords.delete", json!({ "name": "c-1" })).unwrap());
    for answer in &answers {
        assert!(!answer.to_string().contains("password\":"), "{answer}");
        assert!(!answer.to_string().contains(PASSWORD), "{answer}");
    }
}

#[test]
fn a_caller_keeps_256_passwords() {
    let home = home("db-passwords");
    let core = core_with(&Arc::new(FakeKeychain::new()), &home);
    for n in 0..256 {
        keep(&core, DATABASE, &format!("c-{n}"), 5432, "reader", PASSWORD);
    }
    let params = json!({ "name": "c-256", "host": "127.0.0.1", "user": "reader", "password": "x" });
    let refused = call(&core, DATABASE, "db.passwords.set", params).unwrap_err();
    assert_eq!(refused.code, ErrorCode::InvalidValue);
    keep(&core, DATABASE, "c-0", 5432, "reader", "a new one for a kept name");
}

#[test]
fn db_open_signs_in_with_a_kept_password_named_by_password_ref() {
    let home = home("db-passwords");
    let core = core_with(&Arc::new(FakeKeychain::new()), &home);
    let server = Md5Server::start();
    grant(&core, DATABASE, scope());
    let given = open(&core, DATABASE, server.port, json!({ "password": PASSWORD })).unwrap();
    assert!(given["sessionId"].is_string(), "{given}");
    let expected = server.proof().expect("a proof for the given password");
    keep(&core, DATABASE, "c-1", server.port, "reader", PASSWORD);
    let kept = open(&core, DATABASE, server.port, json!({ "passwordRef": "c-1" })).unwrap();
    assert!(kept["sessionId"].is_string(), "{kept}");
    assert_eq!(server.proof().as_deref(), Some(expected.as_str()));
    assert!(!kept.to_string().contains(PASSWORD));
    keep(&core, DATABASE, "c-1", server.port, "reader", "another-password");
    open(&core, DATABASE, server.port, json!({ "passwordRef": "c-1" })).unwrap();
    assert_ne!(server.proof(), Some(expected), "the keychain's value signs in");
}

#[test]
fn the_password_file_answers_before_the_keychain() {
    let home = home("db-passwords");
    let core = core_with(&Arc::new(FakeKeychain::new()), &home);
    let server = Md5Server::start();
    grant(&core, DATABASE, scope());
    open(&core, DATABASE, server.port, json!({ "password": "from-the-file" })).unwrap();
    let from_file = server.proof().unwrap();
    let pgpass = home.join(".pgpass");
    fs::write(
        &pgpass,
        format!("127.0.0.1:{}:shop:reader:from-the-file\n", server.port),
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&pgpass, fs::Permissions::from_mode(0o600)).unwrap();
    }
    keep(&core, DATABASE, "c-1", server.port, "reader", PASSWORD);
    open(&core, DATABASE, server.port, json!({ "passwordRef": "c-1" })).unwrap();
    assert_eq!(server.proof(), Some(from_file));
}

#[test]
fn a_password_kept_for_another_server_user_or_plugin_is_not_used() {
    let home = home("db-passwords");
    let core = core_with(&Arc::new(FakeKeychain::new()), &home);
    let kept_for = Md5Server::start();
    let other = Md5Server::start();
    grant(&core, DATABASE, scope());
    keep(&core, DATABASE, "c-1", kept_for.port, "reader", PASSWORD);
    let needs = json!({ "needsPassword": true });
    let port = open(&core, DATABASE, other.port, json!({ "passwordRef": "c-1" }));
    assert_eq!(port.unwrap(), needs, "another port");
    assert_eq!(other.proof(), None);
    let user = open(
        &core,
        DATABASE,
        kept_for.port,
        json!({ "passwordRef": "c-1", "user": "writer" }),
    );
    assert_eq!(user.unwrap(), needs, "another user");
    let stranger = "example.other";
    grant(&core, stranger, scope());
    let theirs = open(&core, stranger, kept_for.port, json!({ "passwordRef": "c-1" }));
    assert_eq!(theirs.unwrap(), needs, "another plugin's name");
    assert_eq!(kept_for.proof(), None);
    assert_eq!(listed(&core, stranger), json!({ "passwords": [] }));
    call(&core, stranger, "db.passwords.delete", json!({ "name": "c-1" })).unwrap();
    assert_eq!(listed(&core, DATABASE)["passwords"].as_array().unwrap().len(), 1);
}

#[test]
fn forgetting_it_and_removing_the_plugin_delete_the_keychain_entry() {
    let home = home("db-passwords");
    let keychain = Arc::new(FakeKeychain::new());
    let core = core_with(&keychain, &home);
    keep(&core, DATABASE, "c-1", 5432, "reader", PASSWORD);
    call(&core, DATABASE, "db.passwords.delete", json!({ "name": "c-1" })).unwrap();
    call(&core, DATABASE, "db.passwords.delete", json!({ "name": "c-1" })).unwrap();
    assert!(keychain.secrets().is_empty());
    assert_eq!(listed(&core, DATABASE), json!({ "passwords": [] }));

    let declared = json!([{ "permission": "db:connect", "hosts": ["*"] }]);
    install_hello_declaring(&core, &home, declared);
    keep(&core, "example.hello", "c-1", 5432, "reader", PASSWORD);
    keep(&core, "example.hello", "c-2", 5433, "reader", PASSWORD);
    keep(&core, DATABASE, "c-1", 5432, "reader", PASSWORD);
    assert!(core.remove_plugin("example.hello"));
    let left: Vec<_> = keychain.secrets().into_keys().collect();
    assert_eq!(left, ["db/example.database/c-1"]);
    assert_eq!(listed(&core, "example.hello"), json!({ "passwords": [] }));
}

#[test]
fn agents_and_plugins_that_do_not_declare_db_connect_are_refused() {
    let home = home("db-passwords");
    let core = core_with(&Arc::new(FakeKeychain::new()), &home);
    let set = json!({ "name": "c-1", "host": "127.0.0.1", "user": "reader", "password": PASSWORD });
    for (method, params) in [
        ("db.passwords.set", set.clone()),
        ("db.passwords.delete", json!({ "name": "c-1" })),
        ("db.passwords.list", json!({})),
    ] {
        let refused = call(&core, "agent:helper", method, params).unwrap_err();
        assert_eq!(refused.code, ErrorCode::PermissionDenied, "{method}");
    }
    let declared = json!([{ "permission": "net:connect", "hosts": ["*"] }]);
    install_hello_declaring(&core, &home, declared);
    let refused = call(&core, "example.hello", "db.passwords.set", set).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied, "{refused:?}");
    assert_eq!(listed(&core, "example.hello"), json!({ "passwords": [] }));
}

#[test]
fn without_a_keychain_keeping_is_unsupported_and_nothing_is_kept() {
    let set = json!({ "name": "c-1", "host": "127.0.0.1", "user": "reader", "password": PASSWORD });
    let server = Md5Server::start();
    let bare = Core::new(roots(&home("db-passwords")));
    let unavailable = core_with(&Arc::new(FakeKeychain::unavailable()), &home("db-passwords"));
    for core in [bare, unavailable] {
        let refused = call(&core, DATABASE, "db.passwords.set", set.clone()).unwrap_err();
        assert_eq!(refused.code, ErrorCode::Unsupported, "{refused:?}");
        assert_eq!(listed(&core, DATABASE), json!({ "passwords": [] }));
        grant(&core, DATABASE, scope());
        let opened = open(&core, DATABASE, server.port, json!({ "passwordRef": "c-1" }));
        assert_eq!(opened.unwrap(), json!({ "needsPassword": true }));
    }
}

#[test]
fn the_index_survives_a_restart_and_holds_no_password() {
    let home = home("db-passwords");
    let keychain = Arc::new(FakeKeychain::new());
    keep(
        &core_with(&keychain, &home),
        DATABASE,
        "c-1",
        5432,
        "reader",
        PASSWORD,
    );
    let index = fs::read_to_string(home.join("db-passwords.json")).unwrap();
    assert!(index.contains("c-1") && !index.contains(PASSWORD), "{index}");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(home.join("db-passwords.json")).unwrap().permissions();
        assert_eq!(mode.mode() & 0o777, 0o600);
    }
    let again = core_with(&keychain, &home);
    assert_eq!(listed(&again, DATABASE)["passwords"][0]["name"], "c-1");

    // An entry gone from the keychain leaves the index the next time db.open misses it.
    keychain.delete("db/example.database/c-1").unwrap();
    let server = Md5Server::start();
    grant(&again, DATABASE, scope());
    let opened = open(&again, DATABASE, server.port, json!({ "passwordRef": "c-1" }));
    assert_eq!(opened.unwrap(), json!({ "needsPassword": true }));
    assert_eq!(listed(&again, DATABASE), json!({ "passwords": [] }));
}

#[test]
fn password_and_password_ref_together_are_invalid_params() {
    let home = home("db-passwords");
    let core = core_with(&Arc::new(FakeKeychain::new()), &home);
    grant(&core, DATABASE, scope());
    let both = json!({ "password": PASSWORD, "passwordRef": "c-1" });
    let refused = open(&core, DATABASE, Md5Server::start().port, both).unwrap_err();
    assert_eq!(refused.code, ErrorCode::InvalidParams);
}
