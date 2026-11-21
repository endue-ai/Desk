//! What the live tests share: the server named by an environment variable (a `postgresql://` URI;
//! the tests skip when it is unset), a sink that keeps every event, and waits.

#![allow(dead_code)]

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use desk_pg::{Config, Event, Limits, Opened, Page, Session, Sink, Statement, TlsMode};

/// The server `$var` names, or skip the test.
macro_rules! live {
    ($var:expr) => {
        match common::server($var) {
            Some(config) => config,
            None => {
                eprintln!("skipped: {} is unset", $var);
                return;
            }
        }
    };
}

pub fn limits(rows: u64) -> Limits {
    Limits::new(Some(rows), None).unwrap()
}

/// The config the URI in `var` names, or `None` to skip.
pub fn server(var: &str) -> Option<Config> {
    let uri = std::env::var(var).ok().filter(|v| !v.is_empty())?;
    Some(parse(&uri))
}

/// `postgresql://user:password@host:port/database?sslmode=..&sslrootcert=..`
pub fn parse(uri: &str) -> Config {
    let rest = uri
        .strip_prefix("postgresql://")
        .or_else(|| uri.strip_prefix("postgres://"))
        .expect("a postgresql:// URI");
    let (rest, query) = rest.split_once('?').unwrap_or((rest, ""));
    let (who, place) = rest.rsplit_once('@').expect("user@host");
    let (user, password) = who.split_once(':').unwrap_or((who, ""));
    let (address, database) = place.split_once('/').unwrap_or((place, "postgres"));
    let (host, port) = address.rsplit_once(':').unwrap_or((address, "5432"));
    let mut config = Config::new(
        host,
        port.parse().expect("a port"),
        &decode(database),
        &decode(user),
    );
    config.password = (!password.is_empty()).then(|| decode(password));
    for pair in query.split('&').filter(|p| !p.is_empty()) {
        let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
        match name {
            "sslmode" => config.tls = mode(value),
            "sslrootcert" => config.ca_pem = Some(std::fs::read(decode(value)).expect("the CA")),
            _ => {}
        }
    }
    config
}

pub fn mode(name: &str) -> TlsMode {
    match name {
        "disable" => TlsMode::Disable,
        "require" => TlsMode::Require,
        "verify-ca" => TlsMode::VerifyCa,
        "verify-full" => TlsMode::VerifyFull,
        _ => TlsMode::Prefer,
    }
}

fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let hex = text.get(i + 1..i + 3).map(|h| u8::from_str_radix(h, 16));
        if let (b'%', Some(Ok(byte))) = (bytes[i], hex) {
            out.push(byte);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).expect("UTF-8")
}

/// Every event a session sends, in order.
#[derive(Clone, Default)]
pub struct Events(pub Arc<Mutex<Vec<Event>>>);

impl Events {
    pub fn sink(&self) -> Sink {
        let kept = self.0.clone();
        Arc::new(move |event| kept.lock().unwrap().push(event))
    }

    pub fn all(&self) -> Vec<Event> {
        self.0.lock().unwrap().clone()
    }

    /// The first event `pick` takes, waiting up to ten seconds.
    pub fn wait<T>(&self, pick: impl Fn(&Event) -> Option<T>) -> T {
        until(|| self.all().iter().find_map(&pick))
    }
}

/// Wait up to ten seconds for `found` to answer.
pub fn until<T>(found: impl Fn() -> Option<T>) -> T {
    let start = Instant::now();
    loop {
        if let Some(value) = found() {
            return value;
        }
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "waited ten seconds"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

pub fn open(config: &Config) -> (Opened, Events) {
    let events = Events::default();
    let opened = desk_pg::open(config.clone(), events.sink()).expect("the session opens");
    (opened, events)
}

pub fn sql(text: &str) -> Statement {
    Statement {
        sql: text.to_owned(),
        ..Statement::default()
    }
}

/// Run `text` with the default limits; the page must carry no error.
pub fn run(session: &Session, text: &str) -> Page {
    let page = session
        .run(sql(text), Limits::default())
        .expect("the statement runs");
    assert_eq!(page.error, None, "{text}");
    page
}

/// The single value of a one-row, one-column answer.
pub fn value(session: &Session, text: &str) -> Option<String> {
    run(session, text).rows.remove(0).remove(0)
}
