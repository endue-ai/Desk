//! What goes wrong: the server's own errors and notices with every field it sent (`ServerError`),
//! and the session's failures (`Error`), each of which the core answers with one bridge code.

use std::fmt;
use std::io;

use fallible_iterator::FallibleIterator;
use postgres_protocol::message::backend::ErrorFields;

/// An error or a notice as the server sent it: every field by its one-letter code, in order.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ServerError {
    pub fields: Vec<(u8, String)>,
}

impl ServerError {
    pub(crate) fn read(mut fields: ErrorFields<'_>) -> ServerError {
        let mut out = Vec::new();
        while let Ok(Some(field)) = fields.next() {
            let value = String::from_utf8_lossy(field.value_bytes()).into_owned();
            out.push((field.type_(), value));
        }
        ServerError { fields: out }
    }

    /// The field with one-letter code `code`, as the server wrote it.
    pub fn field(&self, code: u8) -> Option<&str> {
        self.fields
            .iter()
            .find(|(c, _)| *c == code)
            .map(|(_, value)| value.as_str())
    }

    /// The severity, never localized (V); servers before 9.6 send only the localized one (S).
    pub fn severity(&self) -> &str {
        self.field(b'V').or_else(|| self.field(b'S')).unwrap_or("")
    }

    /// The SQLSTATE (C).
    pub fn code(&self) -> &str {
        self.field(b'C').unwrap_or("")
    }

    /// The primary message (M).
    pub fn message(&self) -> &str {
        self.field(b'M').unwrap_or("")
    }

    /// Whether the server ends the session after it (FATAL or PANIC).
    pub fn is_fatal(&self) -> bool {
        matches!(self.severity(), "FATAL" | "PANIC")
    }
}

impl fmt::Display for ServerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {}: {}", self.severity(), self.code(), self.message())
    }
}

/// Why a call on a session, or the sign-in, did not give its answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// The call cannot be made as given: a setting the desk keeps, a page limit out of range, a
    /// call the session's state does not take (another statement runs, no COPY is open).
    Invalid(String),
    /// What the session does not speak: a sign-in by GSSAPI, SSPI or Kerberos.
    Unsupported(String),
    /// The network, TLS or the protocol failed, or a certificate failed its mode.
    Io(String),
    /// The connection and the sign-in took longer than the timeout.
    Timeout,
    /// The server refused the sign-in, with its error.
    Refused(ServerError),
    /// The server asks for a password and none was given or found in the password file.
    NeedsPassword,
    /// A row or a COPY message over the limit; the result ended and the session goes on.
    TooLarge(String),
    /// The session has ended.
    Closed,
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Invalid(why) | Error::Unsupported(why) | Error::Io(why) => f.write_str(why),
            Error::TooLarge(why) => f.write_str(why),
            Error::Timeout => f.write_str("the server did not answer in time"),
            Error::Refused(error) => write!(f, "the server refused the sign-in: {error}"),
            Error::NeedsPassword => f.write_str(
                "the server asks for a password: none was given and the password file has none",
            ),
            Error::Closed => f.write_str("the session has ended"),
        }
    }
}

impl std::error::Error for Error {}

impl From<io::Error> for Error {
    fn from(error: io::Error) -> Error {
        match error.kind() {
            io::ErrorKind::UnexpectedEof => Error::Closed,
            io::ErrorKind::TimedOut => Error::Timeout,
            _ => Error::Io(error.to_string()),
        }
    }
}

/// A protocol failure: the server sent what the session did not expect.
pub(crate) fn protocol(what: impl fmt::Display) -> Error {
    Error::Io(format!("protocol: {what}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn error(fields: &[(u8, &str)]) -> ServerError {
        ServerError {
            fields: fields.iter().map(|(c, v)| (*c, (*v).to_owned())).collect(),
        }
    }

    #[test]
    fn fields_are_read_by_their_code() {
        let e = error(&[
            (b'S', "ERREUR"),
            (b'V', "ERROR"),
            (b'C', "23505"),
            (b'M', "duplicate key"),
        ]);
        assert_eq!(e.severity(), "ERROR");
        assert_eq!(e.code(), "23505");
        assert_eq!(e.message(), "duplicate key");
        assert_eq!(e.field(b'D'), None);
        assert!(!e.is_fatal());
        assert_eq!(e.to_string(), "ERROR 23505: duplicate key");
    }

    #[test]
    fn an_old_server_has_only_the_localized_severity() {
        let e = error(&[(b'S', "FATAL"), (b'C', "57P01")]);
        assert_eq!(e.severity(), "FATAL");
        assert!(e.is_fatal());
    }

    #[test]
    fn io_errors_map_to_the_session_s() {
        let eof = io::Error::new(io::ErrorKind::UnexpectedEof, "gone");
        assert_eq!(Error::from(eof), Error::Closed);
        let late = io::Error::new(io::ErrorKind::TimedOut, "late");
        assert_eq!(Error::from(late), Error::Timeout);
        let reset = io::Error::new(io::ErrorKind::ConnectionReset, "reset");
        assert_eq!(Error::from(reset), Error::Io("reset".to_owned()));
    }
}
