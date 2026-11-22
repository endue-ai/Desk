//! PostgreSQL sessions for the core's `db.*` (ADR 0281): protocol 3.0 with the messages and SCRAM
//! of `postgres-protocol`, over tokio and rustls (ring). A session signs in with SCRAM-SHA-256
//! (SCRAM-SHA-256-PLUS over TLS), md5 or the password over TLS, or the password file's, presenting a client certificate when one is given (ADR 0331); runs one
//! statement at a time by the extended protocol with text results, in pages whose `more` is exact;
//! cancels on a connection of its own; copies in and out; and reports notices (a call's as they
//! arrive too, and on its page), notifications,
//! parameter changes and its end as events. Every session's task runs on one runtime thread.

mod binding;
mod cancel;
mod client_cert;
mod config;
mod conn;
mod copy;
mod error;
mod page;
pub mod pgpass;
mod script;
mod select;
mod session;
mod shared;
mod signin;
mod statement;
mod task;
mod tls;

pub use client_cert::{ClientCert, KeyError};
pub use config::{APPLICATION_NAME, Config, DEFAULT_PORT, MAX_OPEN_TIMEOUT, OPEN_TIMEOUT, TlsMode};
pub use conn::TlsInfo;
pub use error::{Error, ServerError};
pub use page::{
    Column, Copy, Direction, Limits, MAX_PAGE_BYTES, MAX_PAGE_ROWS, MIN_PAGE_BYTES, PAGE_BYTES,
    PAGE_ROWS, Page, Row, Transaction,
};
pub use script::Script;
pub use session::{CloseReason, CopyInput, Event, Opened, Session, Sink, Statement, open};
pub use signin::Auth;

/// A data row or COPY message larger than this ends its result (`Error::TooLarge`).
pub const MAX_ROW: usize = 64 * 1024 * 1024;
/// The most bytes one `COPY ... FROM STDIN` chunk carries.
pub const COPY_CHUNK: usize = 1024 * 1024;
