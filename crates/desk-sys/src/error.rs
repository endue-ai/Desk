//! The one error type of the primitives. Its code is the bridge's, so desk-core passes it through.

use std::fmt;
use std::io;

pub use desk_bridge::ErrorCode;

/// A failed primitive call: a bridge error code and a message for people.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    pub code: ErrorCode,
    /// For people; never parse it.
    pub message: String,
}

impl Error {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    /// An `io::Error` with its code, and `context` (usually the path or program) in the message.
    pub fn io(err: &io::Error, context: impl fmt::Display) -> Self {
        Self::new(code_of(err.kind()), format!("{context}: {err}"))
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for Error {}

impl From<io::Error> for Error {
    fn from(err: io::Error) -> Self {
        Self::new(code_of(err.kind()), err.to_string())
    }
}

/// OS permission errors are `io_error`: `permission_denied` means a missing Desk grant.
fn code_of(kind: io::ErrorKind) -> ErrorCode {
    use io::ErrorKind as K;
    match kind {
        K::NotFound => ErrorCode::NotFound,
        K::AlreadyExists => ErrorCode::AlreadyExists,
        K::InvalidInput | K::IsADirectory | K::NotADirectory | K::InvalidFilename => {
            ErrorCode::InvalidParams
        }
        K::TimedOut => ErrorCode::Timeout,
        K::Unsupported => ErrorCode::Unsupported,
        _ => ErrorCode::IoError,
    }
}
