//! The one error type of the index. Its code is the bridge's, so desk-core passes it through.

use std::fmt;

pub use desk_bridge::ErrorCode;

/// A failed index call: a bridge error code and a message for people.
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

    /// A query or an item the index cannot take: `invalid_params`.
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::InvalidParams, message)
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for Error {}

/// Every SQLite failure (a locked, full, missing or damaged file) is `io_error`.
impl From<rusqlite::Error> for Error {
    fn from(err: rusqlite::Error) -> Self {
        Self::new(ErrorCode::IoError, format!("item index: {err}"))
    }
}

impl From<std::io::Error> for Error {
    fn from(err: std::io::Error) -> Self {
        Self::new(ErrorCode::IoError, format!("item index: {err}"))
    }
}

/// The index's results.
pub type Result<T> = std::result::Result<T, Error>;
