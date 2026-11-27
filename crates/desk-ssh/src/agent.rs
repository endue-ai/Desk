//! Signing in with the person's SSH agent: every key it holds, in its order, until the server takes
//! one. The agent signs; no private key reaches the desk. On Unix the agent is the socket
//! `SSH_AUTH_SOCK` names, on Windows the OpenSSH agent's pipe.

use std::path::Path;

use russh::client::Handle;
use russh::keys::agent::client::AgentClient;
use tokio::io::{AsyncRead, AsyncWrite};

use crate::client::Client;

/// The OpenSSH agent's pipe on Windows.
#[cfg(windows)]
const PIPE: &str = r"\\.\pipe\openssh-ssh-agent";

/// Sign `user` in with the agent at `socket`, else the platform's; the reason in words when not.
pub(crate) async fn sign_in(
    handle: &mut Handle<Client>,
    user: &str,
    socket: Option<&Path>,
) -> Result<(), String> {
    #[cfg(unix)]
    {
        let path = match socket {
            Some(path) => path.to_path_buf(),
            None => std::env::var_os("SSH_AUTH_SOCK")
                .map(std::path::PathBuf::from)
                .ok_or_else(|| {
                    "no SSH agent runs for the desk (SSH_AUTH_SOCK is not set)".to_owned()
                })?,
        };
        let agent = AgentClient::connect_uds(&path)
            .await
            .map_err(|e| format!("the SSH agent does not answer ({e})"))?;
        with(handle, user, agent).await
    }
    #[cfg(windows)]
    {
        let pipe = socket
            .map(|p| p.as_os_str().to_owned())
            .unwrap_or_else(|| PIPE.into());
        let agent = AgentClient::connect_named_pipe(&pipe)
            .await
            .map_err(|e| format!("the SSH agent does not answer ({e})"))?;
        with(handle, user, agent).await
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (handle, user, socket);
        Err("this system has no SSH agent the desk can reach".to_owned())
    }
}

async fn with<S>(
    handle: &mut Handle<Client>,
    user: &str,
    mut agent: AgentClient<S>,
) -> Result<(), String>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let identities = agent
        .request_identities()
        .await
        .map_err(|e| format!("the SSH agent did not list its keys ({e})"))?;
    if identities.is_empty() {
        return Err("the SSH agent holds no key".to_owned());
    }
    let hash = handle
        .best_supported_rsa_hash()
        .await
        .map_err(|e| e.to_string())?
        .flatten();
    for identity in identities {
        let key = identity.public_key().into_owned();
        let done = handle
            .authenticate_publickey_with(user, key, hash, &mut agent)
            .await;
        if matches!(done, Ok(result) if result.success()) {
            return Ok(());
        }
    }
    Err(format!("refused every key the SSH agent holds for {user}"))
}
