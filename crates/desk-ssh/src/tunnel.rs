//! The tunnel as its owner holds it: `open` reads the key files, then connects and signs in to each
//! hop in order (the jump host over TCP, the SSH host over a channel of the jump host's, or over
//! TCP), and blocks until the SSH host is signed in, a hop fails, or the time runs out. Streams to
//! the target are direct-tcpip channels of the SSH host's connection: nothing listens on a port.
//! Dropping the tunnel ends both connections. Every tunnel runs on one runtime thread, `desk-ssh`.

use std::io;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::mpsc::sync_channel;
use std::sync::{Arc, OnceLock};
use std::task::{Context, Poll};
use std::thread;

use russh::client::{Handle, Msg};
use russh::keys::PrivateKey;
use russh::{ChannelStream, Disconnect};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::{TcpSocket, TcpStream};
use tokio::runtime::Handle as Runtime;

use crate::client::{self, Client};
use crate::key;
use crate::plan::{Auth, Failure, Hop, Plan, Presented, Stage, Which};

/// An open tunnel. Dropping it ends its SSH connections; streams it opened end with them.
pub struct Tunnel {
    host: Option<Arc<Handle<Client>>>,
    jump: Option<Handle<Client>>,
    presented: Vec<Presented>,
    at: String,
    runtime: Runtime,
}

impl std::fmt::Debug for Tunnel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Tunnel({})", self.at)
    }
}

/// Open the tunnel `plan` names. Blocks until it is open, a hop fails, or `plan.timeout` runs out.
pub fn open(plan: Plan) -> Result<Tunnel, Failure> {
    let runtime = runtime().map_err(|why| {
        let message = format!("The SSH tunnel's runtime did not start: {why}");
        Failure::new(Which::Host, Stage::Connect, message)
    })?;
    // Key files first: a missing passphrase is said before anything connects.
    let jump_key = plan
        .jump
        .as_ref()
        .map(|hop| key_of(hop, Which::Jump))
        .transpose()?
        .flatten();
    let host_key = key_of(&plan.host, Which::Host)?;
    let (reply, answer) = sync_channel(1);
    let (timeout, at) = (plan.timeout, plan.host.at());
    runtime.spawn(async move {
        let opened = tokio::time::timeout(timeout, connect(&plan, jump_key, host_key)).await;
        let opened = opened.unwrap_or_else(|_| {
            let which = Which::Host;
            let message = format!(
                "The SSH tunnel to {} did not open within {} ms.",
                plan.host.at(),
                timeout.as_millis()
            );
            Err(Failure::new(which, Stage::Connect, message))
        });
        let _ = reply.send(opened);
    });
    let (jump, host, presented) = answer.recv().unwrap_or_else(|_| {
        let message = "The SSH tunnel's runtime stopped.".to_owned();
        Err(Failure::new(Which::Host, Stage::Connect, message))
    })?;
    Ok(Tunnel {
        host: Some(Arc::new(host)),
        jump,
        presented,
        at,
        runtime: runtime.clone(),
    })
}

fn key_of(hop: &Hop, which: Which) -> Result<Option<PrivateKey>, Failure> {
    match &hop.auth {
        Auth::KeyFile { path, passphrase } => {
            key::load(which, &hop.user, path, passphrase.as_deref()).map(Some)
        }
        _ => Ok(None),
    }
}

/// What `connect` answers: the jump host's connection, the SSH host's, and their keys in order.
type Connected = (Option<Handle<Client>>, Handle<Client>, Vec<Presented>);

async fn connect(
    plan: &Plan,
    jump_key: Option<PrivateKey>,
    host_key: Option<PrivateKey>,
) -> Result<Connected, Failure> {
    let Some(jump) = &plan.jump else {
        let stream = tcp(&plan.host, Which::Host).await?;
        let (host, key) = client::open(&plan.host, Which::Host, stream, host_key).await?;
        return Ok((None, host, vec![key]));
    };
    let stream = tcp(jump, Which::Jump).await?;
    let (through, first) = client::open(jump, Which::Jump, stream, jump_key).await?;
    let channel = through
        .channel_open_direct_tcpip(&plan.host.host, plan.host.port.into(), "127.0.0.1", 0)
        .await
        .map_err(|e| {
            let why = format!(
                "The jump host {} could not reach the SSH host {}: {e}",
                jump.at(),
                plan.host.at()
            );
            Failure::new(Which::Jump, Stage::Forward, why)
        })?;
    let stream = channel.into_stream();
    let (host, second) = client::open(&plan.host, Which::Host, stream, host_key).await?;
    Ok((Some(through), host, vec![first, second]))
}

/// TCP to the first of the hop's addresses that answers, with keepalive and no Nagle delay.
async fn tcp(hop: &Hop, which: Which) -> Result<TcpStream, Failure> {
    let fail = |why: String| {
        let message = format!("Could not reach {} {}: {why}", which.words(), hop.at());
        Failure::new(which, Stage::Connect, message)
    };
    let addresses: Vec<SocketAddr> = tokio::net::lookup_host((hop.host.as_str(), hop.port))
        .await
        .map_err(|e| fail(format!("its name does not resolve ({e})")))?
        .collect();
    let mut last = "it has no address".to_owned();
    for address in addresses {
        let socket = match address {
            SocketAddr::V4(_) => TcpSocket::new_v4(),
            SocketAddr::V6(_) => TcpSocket::new_v6(),
        };
        let connected = async {
            let socket = socket?;
            socket.set_keepalive(true)?;
            let stream = socket.connect(address).await?;
            stream.set_nodelay(true)?;
            Ok::<_, io::Error>(stream)
        };
        match connected.await {
            Ok(stream) => return Ok(stream),
            Err(e) => last = e.to_string(),
        }
    }
    Err(fail(last))
}

impl Tunnel {
    /// A stream to `host:port` as the SSH host reaches it: a direct-tcpip channel. A refusal says
    /// the SSH host could not reach it.
    pub async fn dial(&self, host: &str, port: u16) -> io::Result<Stream> {
        let Some(handle) = self.host.clone() else {
            return Err(io::Error::other("the SSH tunnel is closed"));
        };
        dial(
            handle,
            self.at.clone(),
            self.runtime.clone(),
            host.to_owned(),
            port,
        )
        .await
    }

    /// `dial`, blocking the calling thread; for an owner outside any runtime.
    pub fn dial_blocking(&self, host: &str, port: u16) -> io::Result<Stream> {
        let Some(handle) = self.host.clone() else {
            return Err(io::Error::other("the SSH tunnel is closed"));
        };
        let (reply, answer) = sync_channel(1);
        let (at, runtime, host) = (self.at.clone(), self.runtime.clone(), host.to_owned());
        self.runtime.spawn(async move {
            let _ = reply.send(dial(handle, at, runtime, host, port).await);
        });
        answer
            .recv()
            .unwrap_or_else(|_| Err(io::Error::other("the SSH tunnel's runtime stopped")))
    }

    /// The key each hop presented, the jump host's first.
    pub fn presented(&self) -> &[Presented] {
        &self.presented
    }

    /// Whether the SSH host's connection has ended.
    pub fn closed(&self) -> bool {
        self.host.as_ref().is_none_or(|handle| handle.is_closed())
    }
}

async fn dial(
    handle: Arc<Handle<Client>>,
    at: String,
    runtime: Runtime,
    host: String,
    port: u16,
) -> io::Result<Stream> {
    let channel = handle
        .channel_open_direct_tcpip(host.as_str(), port.into(), "127.0.0.1", 0)
        .await
        .map_err(|e| {
            let why = format!("The SSH host {at} could not reach {host}:{port}: {e}");
            io::Error::new(io::ErrorKind::ConnectionRefused, why)
        })?;
    Ok(Stream {
        inner: Some(channel.into_stream()),
        runtime,
    })
}

impl Drop for Tunnel {
    fn drop(&mut self) {
        let (host, jump) = (self.host.take(), self.jump.take());
        self.runtime.spawn(async move {
            if let Some(host) = host {
                let _ = host.disconnect(Disconnect::ByApplication, "", "en").await;
            }
            if let Some(jump) = jump {
                let _ = jump.disconnect(Disconnect::ByApplication, "", "en").await;
            }
        });
    }
}

/// A stream through the tunnel. Its channel is dropped on the tunnel's runtime, wherever the
/// stream is dropped.
pub struct Stream {
    inner: Option<ChannelStream<Msg>>,
    runtime: Runtime,
}

impl Stream {
    fn inner(&mut self) -> io::Result<Pin<&mut ChannelStream<Msg>>> {
        match self.inner.as_mut() {
            Some(inner) => Ok(Pin::new(inner)),
            None => Err(io::Error::other("the SSH channel is closed")),
        }
    }
}

impl AsyncRead for Stream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        match self.inner() {
            Ok(inner) => inner.poll_read(cx, buf),
            Err(e) => Poll::Ready(Err(e)),
        }
    }
}

impl AsyncWrite for Stream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        match self.inner() {
            Ok(inner) => inner.poll_write(cx, buf),
            Err(e) => Poll::Ready(Err(e)),
        }
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.inner() {
            Ok(inner) => inner.poll_flush(cx),
            Err(e) => Poll::Ready(Err(e)),
        }
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.inner() {
            Ok(inner) => inner.poll_shutdown(cx),
            Err(e) => Poll::Ready(Err(e)),
        }
    }
}

impl Drop for Stream {
    fn drop(&mut self) {
        if let Some(inner) = self.inner.take() {
            self.runtime.spawn(async move { drop(inner) });
        }
    }
}

/// The one runtime thread every tunnel runs on, started with the first.
fn runtime() -> Result<&'static Runtime, String> {
    static RUNTIME: OnceLock<Result<Runtime, String>> = OnceLock::new();
    RUNTIME
        .get_or_init(|| {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_io()
                .enable_time()
                .build()
                .map_err(|e| e.to_string())?;
            let handle = runtime.handle().clone();
            thread::Builder::new()
                .name("desk-ssh".to_owned())
                .spawn(move || runtime.block_on(std::future::pending::<()>()))
                .map_err(|e| e.to_string())?;
            Ok(handle)
        })
        .as_ref()
        .map_err(Clone::clone)
}
