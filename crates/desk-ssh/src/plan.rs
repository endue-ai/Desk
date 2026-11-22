//! What a tunnel is asked for: its hops in order (an optional jump host, then the SSH host), how
//! each signs in and which host key each may present; and what goes wrong, by hop and stage. A
//! password or passphrase is used for the sign-in only and never printed.

use std::fmt;
use std::path::PathBuf;
use std::time::Duration;

/// SSH's port when none is named.
pub const DEFAULT_PORT: u16 = 22;
/// How long the whole tunnel may take to open, by default.
pub const OPEN_TIMEOUT: Duration = Duration::from_secs(10);
/// The most a key file may hold.
pub const MAX_KEY_FILE: u64 = 64 * 1024;

/// Which hop: the jump host, reached first, or the SSH host the target is reached from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Which {
    Jump,
    Host,
}

impl Which {
    /// The hop in words, as a message names it.
    pub fn words(self) -> &'static str {
        match self {
            Which::Jump => "the jump host",
            Which::Host => "the SSH host",
        }
    }
}

/// How a hop signs in.
#[derive(Clone)]
pub enum Auth {
    /// A private key file, read when the tunnel opens; `passphrase` decrypts an encrypted one.
    KeyFile {
        path: PathBuf,
        passphrase: Option<String>,
    },
    /// The keys the person's SSH agent holds: at `socket`, else the platform's own (the
    /// `SSH_AUTH_SOCK` the core was started with on Unix, the OpenSSH agent's pipe on Windows).
    Agent { socket: Option<PathBuf> },
    /// A password, used once.
    Password(String),
}

/// Which host key a hop may present: the one the caller trusts, else the one the person accepted
/// for a host it trusts none for. A key that differs from `known` is refused whatever `accepted` is.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Trust {
    pub known: Option<String>,
    pub accepted: Option<String>,
}

/// One SSH server of the tunnel.
#[derive(Clone)]
pub struct Hop {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: Auth,
    pub trust: Trust,
}

impl fmt::Debug for Hop {
    /// Never prints a password or a passphrase.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let auth = match &self.auth {
            Auth::KeyFile { path, .. } => format!("key {}", path.display()),
            Auth::Agent { .. } => "agent".to_owned(),
            Auth::Password(_) => "password".to_owned(),
        };
        write!(f, "{}@{}:{} {auth}", self.user, self.host, self.port)
    }
}

impl Hop {
    /// `host:port`, as messages name it.
    pub fn at(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

/// The tunnel: through `jump` when given, to `host`; `timeout` bounds every hop's connection,
/// host key and sign-in together.
#[derive(Debug, Clone)]
pub struct Plan {
    pub jump: Option<Hop>,
    pub host: Hop,
    pub timeout: Duration,
}

/// Where a hop failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    /// The SSH server could not be reached, or the time ran out.
    Connect,
    /// Its host key is not trusted.
    HostKey,
    /// The sign-in was refused, or what it needs is missing.
    Auth,
    /// The SSH server could not reach the next hop or the target.
    Forward,
}

/// Why a host key is not trusted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyStatus {
    Unknown,
    Changed,
}

/// The key a hop presented and why it was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostKey {
    pub status: KeyStatus,
    pub algorithm: String,
    pub fingerprint: String,
    /// The trusted one, for a changed key.
    pub known: Option<String>,
}

/// The key a hop presented and the tunnel took: its trusted one, or the one the person accepted,
/// which its owner keeps from now on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Presented {
    pub which: Which,
    pub algorithm: String,
    pub fingerprint: String,
}

/// What an encrypted key file is missing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Passphrase {
    Needed,
    Wrong,
}

/// A hop that failed, and nothing past it connected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    pub which: Which,
    pub stage: Stage,
    /// What failed in words, naming the hop by its words and `host:port`.
    pub message: String,
    pub host_key: Option<HostKey>,
    pub passphrase: Option<Passphrase>,
}

impl Failure {
    pub(crate) fn new(which: Which, stage: Stage, message: String) -> Failure {
        Failure {
            which,
            stage,
            message,
            host_key: None,
            passphrase: None,
        }
    }
}

impl fmt::Display for Failure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for Failure {}
