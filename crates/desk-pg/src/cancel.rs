//! A cancel request: the backend's pid and key on a connection of its own, over TLS as the
//! session's mode says. The server answers nothing and closes it; the statement's own answer then
//! carries 57014. The key stays here: it never leaves the crate.

use std::time::Duration;

use postgres_protocol::message::frontend;

use crate::config::Config;
use crate::conn::Conn;
use crate::error::Error;

/// Where and how to reach the session's backend, without its password.
#[derive(Clone)]
pub(crate) struct Target {
    pub(crate) config: Config,
    pub(crate) pid: i32,
    pub(crate) key: i32,
}

impl Target {
    pub(crate) fn new(config: &Config, pid: i32, key: i32) -> Target {
        let mut config = config.clone();
        config.password = None;
        Target { config, pid, key }
    }
}

pub(crate) async fn send(target: &Target) -> Result<(), Error> {
    let mut conn = Conn::open(&target.config).await?;
    frontend::cancel_request(target.pid, target.key, &mut conn.out);
    conn.send().await?;
    // The server closes the connection once it has the request.
    let _ = tokio::time::timeout(Duration::from_secs(5), conn.recv()).await;
    Ok(())
}
