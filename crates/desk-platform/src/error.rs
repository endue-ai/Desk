//! What went wrong with a platform call, typed: the error envelope `{ error: { code, message } }` and
//! the status it came with, or the network's failure.

use std::fmt;

use serde_json::Value;

/// The kind of failure, from the status first: what callers decide on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ErrorKind {
    /// No token, or a 401 that one refresh did not cure: the person signs in again.
    SignedOut,
    /// endue AI could not be reached, or did not answer in time.
    Offline,
    /// 403: endue AI refuses the person (another person's agent, a plan that does not allow it).
    Forbidden,
    /// 404 or 410: not there, or past the purge window.
    NotFound,
    /// 400 or 422: endue AI refuses a value.
    Invalid,
    /// 409: the state forbids it (already deleted, already that status).
    Conflict,
    /// Anything else: a 5xx, a body that is not the contract's, a URL that is not one.
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlatformError {
    pub kind: ErrorKind,
    /// The HTTP status, when endue AI answered.
    pub status: Option<u16>,
    /// The envelope's code (`NOT_FOUND`, `ALREADY_DELETED`), when it named one.
    pub code: Option<String>,
    /// For people.
    pub message: String,
}

/// What people read when the desk is not signed in.
pub const SIGN_IN: &str = "Sign in to endue to manage your agents.";

impl PlatformError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            status: None,
            code: None,
            message: message.into(),
        }
    }

    pub fn signed_out() -> Self {
        Self::new(ErrorKind::SignedOut, SIGN_IN)
    }

    /// The error a non-2xx answer stands for: its status and, when the body is the error envelope,
    /// the envelope's code and message.
    pub fn from_response(status: u16, body: &[u8]) -> Self {
        let kind = match status {
            401 => ErrorKind::SignedOut,
            403 => ErrorKind::Forbidden,
            404 | 410 => ErrorKind::NotFound,
            400 | 422 => ErrorKind::Invalid,
            409 => ErrorKind::Conflict,
            _ => ErrorKind::Failed,
        };
        let envelope = serde_json::from_slice::<Value>(body).ok();
        let error = envelope.as_ref().and_then(|v| v.get("error"));
        let text = |key: &str| {
            error
                .and_then(|e| e.get(key))
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .map(str::to_owned)
        };
        let message = match (kind, text("message")) {
            (ErrorKind::SignedOut, _) => SIGN_IN.to_owned(),
            (_, Some(message)) => message,
            _ => format!("endue AI answered {status}"),
        };
        Self {
            kind,
            status: Some(status),
            code: text("code"),
            message,
        }
    }

    /// A body that is not what the contract says.
    pub(crate) fn unexpected(what: &str, why: impl fmt::Display) -> Self {
        Self::new(
            ErrorKind::Failed,
            format!("endue AI's {what} is not what Desk expects: {why}"),
        )
    }
}

impl fmt::Display for PlatformError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for PlatformError {}

pub type Result<T> = std::result::Result<T, PlatformError>;
