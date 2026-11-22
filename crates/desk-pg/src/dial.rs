//! Another way to a server than TCP: a session whose `Config.via` names a `Dial` opens its
//! connection, and each cancel request's, as that dial says (an SSH tunnel's channel, ADR 0359).
//! TLS and the sign-in run over the stream as over TCP, checked against the config's host.

use std::future::Future;
use std::io;
use std::pin::Pin;

use tokio::io::{AsyncRead, AsyncWrite};

/// A byte stream a session runs over.
pub trait Io: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Io for T {}

/// What `Dial::dial` answers.
pub type Dialled<'a> = Pin<Box<dyn Future<Output = io::Result<Box<dyn Io>>> + Send + 'a>>;

/// Opens streams to `host:port` for a session; called on the sessions' runtime thread.
pub trait Dial: Send + Sync {
    fn dial<'a>(&'a self, host: &'a str, port: u16) -> Dialled<'a>;
    /// How the config's Debug names it ("ssh bastion.example.test:22").
    fn name(&self) -> String;
}
