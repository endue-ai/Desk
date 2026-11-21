//! TLS against a real server: `ENDUE_DB_TEST_POSTGRES_TLS` names it (a `postgresql://` URI to
//! `localhost` with `sslmode=verify-full` and `sslrootcert` naming its authority's PEM), and
//! `ENDUE_DB_TEST_POSTGRES_OTHER_CA` an authority that signed nothing. Skips when unset.

#[macro_use]
mod common;

use std::sync::Arc;
use std::time::Duration;

use common::{Events, open, sql, until, value};
use desk_pg::{Auth, Config, Error, Limits, TlsMode};

const VAR: &str = "ENDUE_DB_TEST_POSTGRES_TLS";

fn refused(config: Config) -> String {
    match desk_pg::open(config, Events::default().sink()) {
        Err(Error::Io(why)) => why,
        Err(other) => panic!("refused as io_error, not {other}"),
        Ok(_) => panic!("refused"),
    }
}

#[test]
fn tls_modes() {
    let config = live!(VAR);
    let other = std::env::var("ENDUE_DB_TEST_POSTGRES_OTHER_CA").expect("the other authority");
    let other = std::fs::read(other).unwrap();
    let with = |tls: TlsMode, host: &str, ca: Option<&[u8]>| {
        let mut config = config.clone();
        (config.tls, config.host, config.ca_pem) = (tls, host.to_owned(), ca.map(<[u8]>::to_vec));
        config
    };
    let ca = config.ca_pem.clone().expect("sslrootcert");
    let ca = Some(ca.as_slice());

    let (full, _) = open(&with(TlsMode::VerifyFull, "localhost", ca));
    let tls = full.tls.as_ref().expect("TLS");
    assert!(tls.version.starts_with("TLS"), "{}", tls.version);
    assert!(!tls.cipher.is_empty());
    assert_eq!(
        full.auth,
        Auth::ScramSha256Plus,
        "bound to the server's certificate"
    );
    let ssl = "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()";
    assert_eq!(value(&full.session, ssl), Some("t".to_owned()));

    let name = refused(with(TlsMode::VerifyFull, "127.0.0.1", ca));
    assert!(!name.is_empty(), "verify-full checks the name");
    let (verified, _) = open(&with(TlsMode::VerifyCa, "127.0.0.1", ca));
    assert_eq!(
        verified.auth,
        Auth::ScramSha256Plus,
        "verify-ca checks the chain alone"
    );
    refused(with(TlsMode::VerifyFull, "localhost", Some(&other)));
    refused(with(TlsMode::VerifyCa, "localhost", Some(&other)));
    refused(with(TlsMode::Require, "localhost", Some(&other)));
    let (required, _) = open(&with(TlsMode::Require, "localhost", None));
    assert!(
        required.tls.is_some(),
        "require without an authority checks nothing"
    );
    let (preferred, _) = open(&with(TlsMode::Prefer, "localhost", None));
    assert!(preferred.tls.is_some());
    let (plain, _) = open(&with(TlsMode::Disable, "localhost", None));
    assert_eq!((plain.tls.is_none(), plain.auth), (true, Auth::ScramSha256));
    assert_eq!(value(&plain.session, ssl), Some("f".to_owned()));

    // Cancel goes over TLS too, as the session's mode says.
    let session = Arc::new(full.session);
    let running = session.clone();
    let sleeper =
        std::thread::spawn(move || running.run(sql("SELECT pg_sleep(30)"), Limits::default()));
    until(|| session.running().then_some(()));
    std::thread::sleep(Duration::from_millis(300));
    session.cancel().unwrap();
    assert_eq!(
        sleeper.join().unwrap().unwrap().error.unwrap().code(),
        "57014"
    );
}
