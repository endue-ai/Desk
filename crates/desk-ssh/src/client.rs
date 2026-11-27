//! One hop: the SSH handshake over a stream (TCP, or a channel of the hop before), its host key
//! checked against what the caller trusts, then the sign-in. Each failure names the hop.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::{self, Handle, KeyboardInteractiveAuthResponse};
use russh::keys::{HashAlg, PrivateKey, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{MethodKind, Preferred};
use tokio::io::{AsyncRead, AsyncWrite};

use crate::agent;
use crate::plan::{Auth, Failure, Hop, HostKey, KeyStatus, Presented, Stage, Which};

/// The key a hop presented, and why it was refused when it was.
#[derive(Default)]
struct Seen {
    presented: Option<Presented>,
    refused: Option<HostKey>,
}

/// The client side of one hop: checks the host key against the hop's trust.
pub(crate) struct Client {
    which: Which,
    trust: crate::plan::Trust,
    seen: Arc<Mutex<Seen>>,
}

impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let data = match key {
            PublicKeyOrCertificate::PublicKey { key, .. } => key.key_data().clone(),
            PublicKeyOrCertificate::Certificate(cert) => cert.public_key().clone(),
        };
        let fingerprint = data.fingerprint(HashAlg::Sha256).to_string();
        let algorithm = data.algorithm().as_str().to_owned();
        let status = match (&self.trust.known, &self.trust.accepted) {
            (Some(known), _) if *known == fingerprint => None,
            (Some(_), _) => Some(KeyStatus::Changed),
            (None, Some(accepted)) if *accepted == fingerprint => None,
            (None, _) => Some(KeyStatus::Unknown),
        };
        let refused = status.map(|status| HostKey {
            status,
            algorithm,
            fingerprint,
            known: self
                .trust
                .known
                .clone()
                .filter(|_| status == KeyStatus::Changed),
        });
        let trusted = refused.is_none();
        let mut seen = lock(&self.seen);
        seen.presented = Some(Presented {
            which: self.which,
            algorithm: data.algorithm().as_str().to_owned(),
            fingerprint: data.fingerprint(HashAlg::Sha256).to_string(),
        });
        seen.refused = refused;
        Ok(trusted)
    }
}

fn lock(seen: &Mutex<Seen>) -> std::sync::MutexGuard<'_, Seen> {
    seen.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The client's settings: no compression; keepalives so a dead hop ends the tunnel.
fn config() -> Arc<client::Config> {
    let preferred = Preferred {
        compression: std::borrow::Cow::Borrowed(&[russh::compression::NONE]),
        ..Preferred::default()
    };
    Arc::new(client::Config {
        preferred,
        nodelay: true,
        keepalive_interval: Some(Duration::from_secs(30)),
        keepalive_max: 3,
        inactivity_timeout: None,
        ..Default::default()
    })
}

/// The handshake and the sign-in of `hop` over `stream`; `key` is its key file, decoded.
pub(crate) async fn open<S>(
    hop: &Hop,
    which: Which,
    stream: S,
    key: Option<PrivateKey>,
) -> Result<(Handle<Client>, Presented), Failure>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let seen = Arc::new(Mutex::new(Seen::default()));
    let handler = Client {
        which,
        trust: hop.trust.clone(),
        seen: seen.clone(),
    };
    let at = hop.at();
    let mut handle = match client::connect_stream(config(), stream, handler).await {
        Ok(handle) => handle,
        Err(error) => {
            if let Some(refused) = lock(&seen).refused.take() {
                return Err(host_key(which, &at, refused));
            }
            let why = format!(
                "{} {at} did not finish the SSH handshake: {error}",
                which.words()
            );
            return Err(Failure::new(which, Stage::Connect, capital(&why)));
        }
    };
    sign_in(&mut handle, hop, which, key).await?;
    let presented = lock(&seen).presented.take();
    let presented = presented.ok_or_else(|| {
        let why = format!("{} {at} signed in without a host key", which.words());
        Failure::new(which, Stage::HostKey, capital(&why))
    })?;
    Ok((handle, presented))
}

fn host_key(which: Which, at: &str, refused: HostKey) -> Failure {
    let words = which.words();
    let message = match refused.status {
        KeyStatus::Unknown => format!(
            "{words} {at} presented the {} key {}, which this desk has not trusted yet.",
            refused.algorithm, refused.fingerprint
        ),
        KeyStatus::Changed => format!(
            "{words} {at} presented the {} key {}, not the trusted {}: refused. The key changed, or something sits between the desk and the server; forget the trusted key only if you know the server's key was replaced.",
            refused.algorithm,
            refused.fingerprint,
            refused.known.as_deref().unwrap_or("key")
        ),
    };
    let mut failure = Failure::new(which, Stage::HostKey, capital(&message));
    failure.host_key = Some(refused);
    failure
}

async fn sign_in(
    handle: &mut Handle<Client>,
    hop: &Hop,
    which: Which,
    key: Option<PrivateKey>,
) -> Result<(), Failure> {
    let at = hop.at();
    let user = hop.user.as_str();
    let refused = |what: &str| {
        let why = format!("{} {at} refused {what} for {user}.", which.words());
        Failure::new(which, Stage::Auth, capital(&why))
    };
    let broken = |e: russh::Error| {
        let why = format!("{} {at} ended the sign-in: {e}", which.words());
        Failure::new(which, Stage::Auth, capital(&why))
    };
    match &hop.auth {
        Auth::KeyFile { path, .. } => {
            let Some(key) = key else {
                return Err(refused("the key file"));
            };
            let hash = handle.best_supported_rsa_hash().await.map_err(broken)?;
            let key = PrivateKeyWithHashAlg::new(Arc::new(key), hash.flatten());
            let done = handle
                .authenticate_publickey(user, key)
                .await
                .map_err(broken)?;
            if !done.success() {
                return Err(refused(&format!("the key {}", path.display())));
            }
        }
        Auth::Password(password) => {
            let done = handle
                .authenticate_password(user, password.clone())
                .await
                .map_err(broken)?;
            let others = match done {
                client::AuthResult::Success => return Ok(()),
                client::AuthResult::Failure {
                    remaining_methods, ..
                } => remaining_methods,
            };
            // A server that asks for the password by keyboard-interactive instead.
            let typed = others.contains(&MethodKind::KeyboardInteractive)
                && interactive(handle, user, password).await.map_err(broken)?;
            if !typed {
                return Err(refused("the password"));
            }
        }
        Auth::Agent { socket } => {
            let why = agent::sign_in(handle, user, socket.as_deref()).await;
            if let Err(why) = why {
                let message = format!("{} {at}: {why}", which.words());
                return Err(Failure::new(which, Stage::Auth, capital(&message)));
            }
        }
    }
    Ok(())
}

/// Keyboard-interactive answered with the password: one hidden prompt at a time, no other.
async fn interactive(
    handle: &mut Handle<Client>,
    user: &str,
    password: &str,
) -> Result<bool, russh::Error> {
    let mut reply = handle
        .authenticate_keyboard_interactive_start(user, None)
        .await?;
    for _ in 0..4 {
        match reply {
            KeyboardInteractiveAuthResponse::Success => return Ok(true),
            KeyboardInteractiveAuthResponse::Failure { .. } => return Ok(false),
            KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                if prompts.len() > 1 || prompts.iter().any(|p| p.echo) {
                    return Ok(false);
                }
                let answers = prompts.iter().map(|_| password.to_owned()).collect();
                reply = handle
                    .authenticate_keyboard_interactive_respond(answers)
                    .await?;
            }
        }
    }
    Ok(false)
}

/// The sentence with its first letter in capitals.
pub(crate) fn capital(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}
