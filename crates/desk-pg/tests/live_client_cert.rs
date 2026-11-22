//! A client certificate against a real server (ADR 0331): `ENDUE_DB_TEST_POSTGRES_CLIENT_CERT`
//! names one whose pg_hba says `clientcert=verify-full` for the URI's user (a `postgresql://` URI
//! with `sslmode`, `sslrootcert`, `sslcert`, `sslkey` and, for an encrypted key, `sslpassword`).
//! With the certificate the session opens and the server sees it; without one the server refuses;
//! a cancel goes over the same TLS. Skips when unset.

#[macro_use]
mod common;

use std::sync::Arc;
use std::time::Duration;

use common::{Events, open, sql, until, value};
use desk_pg::{Error, Limits};

const VAR: &str = "ENDUE_DB_TEST_POSTGRES_CLIENT_CERT";

#[test]
fn a_server_that_requires_a_client_certificate() {
    let config = live!(VAR);
    assert!(
        config.client_cert.is_some(),
        "the URI names sslcert and sslkey"
    );

    let (opened, _) = open(&config);
    let dn = "SELECT client_dn FROM pg_stat_ssl WHERE pid = pg_backend_pid()";
    let seen = value(&opened.session, dn).expect("the server saw a certificate");
    assert!(seen.contains(&format!("CN={}", config.user)), "{seen}");

    let mut bare = config.clone();
    bare.client_cert = None;
    match desk_pg::open(bare, Events::default().sink()) {
        Err(Error::Refused(refusal)) => assert_eq!(refusal.code(), "28000", "{refusal:?}"),
        Err(other) => panic!("refused by the server, not {other}"),
        Ok(_) => panic!("a session without the certificate is refused"),
    }

    let session = Arc::new(opened.session);
    let running = session.clone();
    let sleeper =
        std::thread::spawn(move || running.run(sql("SELECT pg_sleep(30)"), Limits::default()));
    until(|| session.running().then_some(()));
    std::thread::sleep(Duration::from_millis(300));
    session.cancel().unwrap();
    let page = sleeper.join().unwrap().unwrap();
    assert_eq!(page.error.unwrap().code(), "57014");
}
