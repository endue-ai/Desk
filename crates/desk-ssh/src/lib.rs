//! SSH tunnels for the core's database sessions (ADR 0359), on the pure-Rust `russh` client with
//! ring. A tunnel is one SSH connection, through an optional jump host, opened before its session
//! and dropped with it; the session's streams (its connection and its cancel requests) are
//! direct-tcpip channels inside the process, so nothing listens on a port. Each hop's host key is
//! checked against the fingerprint its owner trusts or the person accepted, never taken silently;
//! a key file is read and decoded here, and no key, passphrase or password is printed or handed
//! back. A failure names its hop (the jump host, the SSH host) and stage (connect, host key, auth,
//! forward). The crate knows nothing of plugins or grants: `desk-core` decides what is trusted.

mod agent;
mod client;
mod key;
mod plan;
#[cfg(feature = "testing")]
pub mod testing;
mod tunnel;

pub use plan::{
    Auth, DEFAULT_PORT, Failure, Hop, HostKey, KeyStatus, MAX_KEY_FILE, OPEN_TIMEOUT, Passphrase,
    Plan, Presented, Stage, Trust, Which,
};
pub use tunnel::{Stream, Tunnel, open};
