//! What a session connects with: where, who, the TLS mode with its authorities, the startup
//! settings and how long the connection and the sign-in may take. The password is used for the
//! sign-in and dropped; it is never printed.

use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use crate::client_cert::ClientCert;
use crate::dial::Dial;
use crate::error::Error;

/// How long the connection and the sign-in take at most, by default and at the most.
pub const OPEN_TIMEOUT: Duration = Duration::from_secs(10);
pub const MAX_OPEN_TIMEOUT: Duration = Duration::from_secs(120);
/// PostgreSQL's port when none is named.
pub const DEFAULT_PORT: u16 = 5432;
/// Who the server sees connecting, unless the settings name another `application_name`.
pub const APPLICATION_NAME: &str = "endue Desk";

/// libpq's TLS modes, less `allow` (plain first, TLS only when the server insists).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TlsMode {
    /// Plain TCP.
    Disable,
    /// TLS when the server has it, else plain, as libpq does by default.
    #[default]
    Prefer,
    /// TLS, the certificate not checked (checked as `VerifyCa` when authorities are given).
    Require,
    /// TLS, the chain checked against the authorities (the OS's when none are given).
    VerifyCa,
    /// TLS, the chain and the host name checked.
    VerifyFull,
}

impl TlsMode {
    pub fn name(self) -> &'static str {
        match self {
            TlsMode::Disable => "disable",
            TlsMode::Prefer => "prefer",
            TlsMode::Require => "require",
            TlsMode::VerifyCa => "verify-ca",
            TlsMode::VerifyFull => "verify-full",
        }
    }
}

/// A connection's values. `password` is used for the sign-in only; without one, the password
/// file answers, as libpq's does.
#[derive(Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
    pub password: Option<String>,
    /// The password file to read when no password is given (`pgpass::default_file`).
    pub password_file: Option<PathBuf>,
    pub tls: TlsMode,
    /// The PEM of the authorities to trust; the OS's trust store when absent.
    pub ca_pem: Option<Vec<u8>>,
    /// The certificate and key presented when the server asks for one (ADR 0331).
    pub client_cert: Option<ClientCert>,
    /// Startup parameters (`DateStyle`, `TimeZone`, `search_path`, ...), in order.
    pub settings: Vec<(String, String)>,
    /// Adds `default_transaction_read_only=on`: the server refuses writes.
    pub read_only: bool,
    /// For the connection and the sign-in together.
    pub timeout: Duration,
    /// How to reach the server instead of TCP: an SSH tunnel's channels (ADR 0359).
    pub via: Option<Arc<dyn Dial>>,
}

impl fmt::Debug for Config {
    /// Never prints the password.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}@{}:{}/{} tls={}{} read_only={}",
            self.user,
            self.host,
            self.port,
            self.database,
            self.tls.name(),
            if self.client_cert.is_some() {
                " client_cert"
            } else {
                ""
            },
            self.read_only
        )?;
        match &self.via {
            Some(via) => write!(f, " via {}", via.name()),
            None => Ok(()),
        }
    }
}

/// Settings the session keeps itself: the encoding stays UTF-8 (values are UTF-8 text), and who
/// and where are their own fields; a replication connection is not a session.
const KEPT: [&str; 4] = ["client_encoding", "user", "database", "replication"];

impl Config {
    pub fn new(host: &str, port: u16, database: &str, user: &str) -> Config {
        Config {
            host: host.to_owned(),
            port,
            database: database.to_owned(),
            user: user.to_owned(),
            password: None,
            password_file: None,
            tls: TlsMode::default(),
            ca_pem: None,
            client_cert: None,
            settings: Vec::new(),
            read_only: false,
            timeout: OPEN_TIMEOUT,
            via: None,
        }
    }

    /// Whether the values can go into a startup message: settings the session keeps are
    /// `Error::Invalid`, as are empty names and NUL bytes, which the message cannot carry.
    pub fn check(&self) -> Result<(), Error> {
        let invalid = |why: String| Err(Error::Invalid(why));
        if self.host.is_empty() || self.user.is_empty() || self.database.is_empty() {
            return invalid("host, database and user are not empty".to_owned());
        }
        let texts = [&self.host, &self.user, &self.database];
        if texts.iter().any(|t| t.contains('\0')) {
            return invalid("host, database and user hold no NUL".to_owned());
        }
        for (name, value) in &self.settings {
            if name.is_empty() || name.contains('\0') || value.contains('\0') {
                return invalid(format!("the setting {name:?} cannot be sent"));
            }
            if KEPT.contains(&name.to_ascii_lowercase().as_str()) {
                return invalid(format!("{name} is the session's own and cannot be set"));
            }
        }
        if self.timeout.is_zero() || self.timeout > MAX_OPEN_TIMEOUT {
            return invalid("the timeout is 1 ms to 120 s".to_owned());
        }
        Ok(())
    }

    /// The startup message's parameters: who and where, UTF-8, the settings, then read-only.
    pub(crate) fn startup(&self) -> Vec<(String, String)> {
        let named = |name: &str| {
            self.settings
                .iter()
                .any(|(n, _)| n.eq_ignore_ascii_case(name))
        };
        let mut out = vec![
            ("user".to_owned(), self.user.clone()),
            ("database".to_owned(), self.database.clone()),
            ("client_encoding".to_owned(), "UTF8".to_owned()),
        ];
        if !named("application_name") {
            out.push(("application_name".to_owned(), APPLICATION_NAME.to_owned()));
        }
        let read_only = "default_transaction_read_only";
        for (name, value) in &self.settings {
            if !(self.read_only && name.eq_ignore_ascii_case(read_only)) {
                out.push((name.clone(), value.clone()));
            }
        }
        if self.read_only {
            out.push((read_only.to_owned(), "on".to_owned()));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> Config {
        Config::new("db.example.com", DEFAULT_PORT, "app", "ada")
    }

    #[test]
    fn the_session_keeps_its_own_settings() {
        for name in ["client_encoding", "User", "DATABASE", "replication"] {
            let mut c = config();
            c.settings.push((name.to_owned(), "x".to_owned()));
            assert!(matches!(c.check(), Err(Error::Invalid(_))), "{name}");
        }
        let mut c = config();
        c.settings
            .push(("search_path".to_owned(), "a\0b".to_owned()));
        assert!(matches!(c.check(), Err(Error::Invalid(_))));
        let mut c = config();
        c.timeout = Duration::from_secs(121);
        assert!(matches!(c.check(), Err(Error::Invalid(_))));
        assert_eq!(config().check(), Ok(()));
    }

    #[test]
    fn the_startup_message_names_utf8_the_settings_and_read_only_last() {
        let mut c = config();
        c.settings = vec![
            ("TimeZone".to_owned(), "UTC".to_owned()),
            ("default_transaction_read_only".to_owned(), "off".to_owned()),
        ];
        c.read_only = true;
        let names: Vec<String> = c
            .startup()
            .into_iter()
            .map(|(n, v)| format!("{n}={v}"))
            .collect();
        assert_eq!(
            names,
            [
                "user=ada",
                "database=app",
                "client_encoding=UTF8",
                "application_name=endue",
                "TimeZone=UTC",
                "default_transaction_read_only=on",
            ]
        );
        let mut named = config();
        named.settings = vec![("application_name".to_owned(), "mine".to_owned())];
        assert!(!named.startup().iter().any(|(_, v)| v == APPLICATION_NAME));
    }

    #[test]
    fn debug_never_prints_the_password() {
        let mut c = config();
        c.password = Some("hunter2".to_owned());
        let text = format!("{c:?}");
        assert!(!text.contains("hunter2"), "{text}");
        assert!(text.contains("ada@db.example.com:5432/app"), "{text}");
    }
}
