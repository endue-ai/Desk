//! For tests (feature `testing`): an SSH server in the test process on a loopback port, which signs
//! in one user by key or password and forwards direct-tcpip channels to loopback ports only; an
//! echo listener to forward to; and keys made at test time. Nothing here is built into the desk.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::sync_channel;
use std::thread;
use std::time::Duration;

use russh::keys::ssh_key::LineEnding;
use russh::keys::{Algorithm, HashAlg, PrivateKey, PublicKey};
use russh::server::{self, Auth, ChannelOpenHandle, Msg, Server as _, Session, VerifiedPublicKey};
use russh::{Channel, ChannelOpenFailure};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// A new Ed25519 key.
pub fn key() -> PrivateKey {
    PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519).expect("an Ed25519 key")
}

/// `key` written to `dir/name` in OpenSSH's format, encrypted with `passphrase` when given.
pub fn write_key(dir: &Path, name: &str, key: &PrivateKey, passphrase: Option<&str>) -> PathBuf {
    let key = match passphrase {
        Some(passphrase) => key
            .encrypt(&mut rand::rng(), passphrase)
            .expect("encrypted"),
        None => key.clone(),
    };
    let path = dir.join(name);
    let text = key.to_openssh(LineEnding::LF).expect("OpenSSH text");
    std::fs::write(&path, text.as_bytes()).expect("key written");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let private = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(&path, private).expect("key made private");
    }
    path
}

/// The SHA-256 fingerprint of `key`'s public half, as OpenSSH prints it.
pub fn fingerprint(key: &PrivateKey) -> String {
    key.public_key().fingerprint(HashAlg::Sha256).to_string()
}

/// Who the server signs in.
#[derive(Clone)]
pub struct Account {
    pub user: String,
    pub password: Option<String>,
    pub keys: Vec<PublicKey>,
}

/// A running SSH server; it stops when dropped.
pub struct Server {
    pub port: u16,
    pub host_key: PrivateKey,
    live: Arc<AtomicUsize>,
    seen: Arc<AtomicUsize>,
    forwarded: Arc<AtomicUsize>,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
}

impl Server {
    /// A server on a free loopback port with the host key `host_key`.
    pub fn start(host_key: PrivateKey, account: Account) -> Server {
        let live = Arc::new(AtomicUsize::new(0));
        let seen = Arc::new(AtomicUsize::new(0));
        let forwarded = Arc::new(AtomicUsize::new(0));
        let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
        let (ready, port) = sync_channel(1);
        let config = Arc::new(server::Config {
            keys: vec![host_key.clone()],
            auth_rejection_time: Duration::from_millis(1),
            auth_rejection_time_initial: Some(Duration::ZERO),
            inactivity_timeout: None,
            ..Default::default()
        });
        let mut serve = Serve {
            account: Arc::new(account),
            live: live.clone(),
            seen: seen.clone(),
            forwarded: forwarded.clone(),
        };
        thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("a runtime");
            runtime.block_on(async move {
                let socket = TcpListener::bind("127.0.0.1:0").await.expect("a port");
                let _ = ready.send(socket.local_addr().expect("an address").port());
                tokio::select! {
                    _ = serve.run_on_socket(config, &socket) => {}
                    _ = stopped => {}
                }
            });
        });
        Server {
            port: port.recv().expect("the server's port"),
            host_key,
            live,
            seen,
            forwarded,
            stop: Some(stop),
        }
    }

    /// SSH connections open now.
    pub fn live(&self) -> usize {
        self.live.load(Ordering::SeqCst)
    }

    /// SSH connections it has taken, open or not.
    pub fn seen(&self) -> usize {
        self.seen.load(Ordering::SeqCst)
    }

    /// direct-tcpip channels it has forwarded.
    pub fn forwarded(&self) -> usize {
        self.forwarded.load(Ordering::SeqCst)
    }

    /// Wait up to two seconds for `live()` to be `n`.
    pub fn wait_live(&self, n: usize) -> bool {
        for _ in 0..200 {
            if self.live() == n {
                return true;
            }
            thread::sleep(Duration::from_millis(10));
        }
        false
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
    }
}

/// A TCP listener on a free loopback port that echoes what it reads, until the process ends.
pub fn echo() -> u16 {
    let (ready, port) = sync_channel(1);
    thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a runtime");
        runtime.block_on(async move {
            let socket = TcpListener::bind("127.0.0.1:0").await.expect("a port");
            let _ = ready.send(socket.local_addr().expect("an address").port());
            while let Ok((mut stream, _)) = socket.accept().await {
                tokio::spawn(async move {
                    let mut buf = [0u8; 4096];
                    while let Ok(n) = stream.read(&mut buf).await {
                        if n == 0 || stream.write_all(&buf[..n]).await.is_err() {
                            break;
                        }
                    }
                });
            }
        });
    });
    port.recv().expect("the echo port")
}

#[derive(Clone)]
struct Serve {
    account: Arc<Account>,
    live: Arc<AtomicUsize>,
    seen: Arc<AtomicUsize>,
    forwarded: Arc<AtomicUsize>,
}

/// One client's connection; counted live until it ends.
struct Connection {
    serve: Serve,
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.serve.live.fetch_sub(1, Ordering::SeqCst);
    }
}

impl server::Server for Serve {
    type Handler = Connection;

    fn new_client(&mut self, _: Option<SocketAddr>) -> Connection {
        self.live.fetch_add(1, Ordering::SeqCst);
        self.seen.fetch_add(1, Ordering::SeqCst);
        Connection {
            serve: self.clone(),
        }
    }
}

impl server::Handler for Connection {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        let account = &self.serve.account;
        let ok = user == account.user && account.password.as_deref() == Some(password);
        Ok(if ok { Auth::Accept } else { Auth::reject() })
    }

    async fn auth_publickey_offered(
        &mut self,
        user: &str,
        offer: server::PublicKeyOffer<'_>,
    ) -> Result<Auth, Self::Error> {
        Ok(self.takes(user, offer.public_key))
    }

    async fn auth_publickey(
        &mut self,
        user: &str,
        key: VerifiedPublicKey<'_>,
    ) -> Result<Auth, Self::Error> {
        Ok(self.takes(user, key.public_key))
    }

    async fn channel_open_direct_tcpip(
        &mut self,
        channel: Channel<Msg>,
        host: &str,
        port: u32,
        _originator: &str,
        _originator_port: u32,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        let loopback = matches!(host, "127.0.0.1" | "localhost");
        let port = u16::try_from(port).ok().filter(|_| loopback);
        let target = match port {
            Some(port) => TcpStream::connect(("127.0.0.1", port)).await.ok(),
            None => None,
        };
        let Some(mut target) = target else {
            reply.reject(ChannelOpenFailure::ConnectFailed).await;
            return Ok(());
        };
        reply.accept().await;
        self.serve.forwarded.fetch_add(1, Ordering::SeqCst);
        tokio::spawn(async move {
            let mut stream = channel.into_stream();
            let _ = tokio::io::copy_bidirectional(&mut stream, &mut target).await;
        });
        Ok(())
    }
}

impl Connection {
    fn takes(&self, user: &str, key: &PublicKey) -> Auth {
        let account = &self.serve.account;
        let known = account.keys.iter().any(|k| k.key_data() == key.key_data());
        if user == account.user && known {
            Auth::Accept
        } else {
            Auth::reject()
        }
    }
}
