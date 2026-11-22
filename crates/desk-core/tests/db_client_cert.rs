//! db.open's client certificate (ADR 0331) without a database server: the key is decoded before
//! anything connects, so an encrypted key without its passphrase answers `keyPassword: needed`
//! even though nobody listens on the port, a key that is not one is `invalid_value`, and a key
//! without its certificate is `invalid_params`. `disable` has no TLS and ignores both.

mod support;

use std::net::TcpListener;

use desk_bridge::{BridgeError, ErrorCode};
use desk_core::Core;
use serde_json::{Value, json};
use support::{call, grant, home, roots};

const DATABASE: &str = "example.database";
const CERT: &str = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
const ENCRYPTED: &str =
    "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIB\n-----END ENCRYPTED PRIVATE KEY-----\n";

fn open(core: &Core, port: u16, tls: Value) -> Result<Value, BridgeError> {
    let params = json!({ "engine": "postgresql", "host": "127.0.0.1", "port": port,
        "database": "shop", "user": "reader", "password": "fixture-password", "tls": tls,
        "scope": { "permission": "db:connect", "hosts": ["127.0.0.1"] } });
    call(core, DATABASE, "db.open", params)
}

/// A port nobody listens on: bound, then let go.
fn free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.local_addr().unwrap().port()
}

#[test]
fn a_client_key_that_needs_a_passphrase_answers_key_password_before_anything_connects() {
    let core = Core::new(roots(&home("db-client-cert")));
    grant(
        &core,
        DATABASE,
        json!({ "permission": "db:connect", "hosts": ["127.0.0.1"] }),
    );
    let port = free_port();

    let tls = json!({ "mode": "require", "cert": CERT, "key": ENCRYPTED });
    let needed = open(&core, port, tls).unwrap();
    assert_eq!(needed, json!({ "keyPassword": "needed" }));

    let tls = json!({ "mode": "require", "cert": CERT, "key": "no key here" });
    let refused = open(&core, port, tls).unwrap_err();
    assert_eq!(refused.code, ErrorCode::InvalidValue, "{refused:?}");
    assert!(
        refused.message.contains("client key"),
        "{}",
        refused.message
    );

    let alone = open(&core, port, json!({ "mode": "require", "key": ENCRYPTED })).unwrap_err();
    assert_eq!(alone.code, ErrorCode::InvalidParams, "{alone:?}");

    // disable has no TLS: the certificate is not looked at, and the refused port says so.
    let tls = json!({ "mode": "disable", "cert": CERT, "key": ENCRYPTED });
    let plain = open(&core, port, tls).unwrap_err();
    assert_eq!(plain.code, ErrorCode::IoError, "{plain:?}");
    assert_eq!(core.database_count(), 0);
}
