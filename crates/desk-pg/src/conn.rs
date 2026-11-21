//! The socket under a session: TCP with keepalive, then TLS after the SSLRequest byte when the mode
//! asks for it, and messages in and out. A data row or COPY message over the limit is skipped as
//! it streams, never held whole.

use std::io;
use std::net::SocketAddr;

use bytes::{Buf, BytesMut};
use postgres_protocol::message::backend::Message;
use postgres_protocol::message::frontend;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpSocket, TcpStream};
use tokio_rustls::TlsConnector;

use crate::config::{Config, TlsMode};
use crate::error::{Error, protocol};
use crate::{MAX_ROW, binding, tls};

pub(crate) trait Io: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Io for T {}

/// The TLS a connection ended up with, and SCRAM's binding data for its certificate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TlsInfo {
    pub version: String,
    pub cipher: String,
    pub(crate) end_point: Option<Vec<u8>>,
}

/// What `recv` read: a message, or one over the limit that was skipped (`tag`, its length).
pub(crate) enum Read {
    Message(Message),
    Skipped(u8),
}

pub(crate) struct Conn {
    io: Box<dyn Io>,
    buf: BytesMut,
    /// What `send` writes next.
    pub(crate) out: BytesMut,
    pub(crate) tls: Option<TlsInfo>,
    /// A message over the limit being read past: its tag and the bytes left.
    skipping: Option<(u8, usize)>,
}

impl Conn {
    /// Open the socket for `config`; `prefer` falls back to plain TCP when the server has no TLS
    /// or its handshake fails, as libpq does.
    pub(crate) async fn open(config: &Config) -> Result<Conn, Error> {
        let stream = tcp(&config.host, config.port).await?;
        if config.tls == TlsMode::Disable {
            return Ok(Conn::new(Box::new(stream), None));
        }
        match secure(stream, config).await {
            Ok(conn) => Ok(conn),
            Err(_) if config.tls == TlsMode::Prefer => {
                let stream = tcp(&config.host, config.port).await?;
                Ok(Conn::new(Box::new(stream), None))
            }
            Err(error) => Err(error),
        }
    }

    fn new(io: Box<dyn Io>, tls: Option<TlsInfo>) -> Conn {
        Conn {
            io,
            buf: BytesMut::with_capacity(64 * 1024),
            out: BytesMut::new(),
            tls,
            skipping: None,
        }
    }

    /// Write what `out` holds and flush it.
    pub(crate) async fn send(&mut self) -> Result<(), Error> {
        let out = self.out.split();
        self.io.write_all(&out).await?;
        self.io.flush().await?;
        Ok(())
    }

    /// The next message; one over `MAX_ROW` is skipped as it streams. Cancel-safe: what was read
    /// stays in the buffer, and a skip goes on where it stopped.
    pub(crate) async fn recv(&mut self) -> Result<Read, Error> {
        loop {
            if let Some((tag, left)) = self.skipping {
                let gone = left.min(self.buf.len());
                self.buf.advance(gone);
                self.skipping = Some((tag, left - gone));
                if left == gone {
                    self.skipping = None;
                    return Ok(Read::Skipped(tag));
                }
            } else if self.buf.len() >= 5 {
                let tag = self.buf[0];
                let len = u32::from_be_bytes([self.buf[1], self.buf[2], self.buf[3], self.buf[4]]);
                if len as usize > MAX_ROW {
                    self.skipping = Some((tag, len as usize + 1));
                    continue;
                }
            }
            if self.skipping.is_none()
                && let Some(message) = Message::parse(&mut self.buf).map_err(protocol)?
            {
                return Ok(Read::Message(message));
            }
            if self.buf.capacity() - self.buf.len() < 16 * 1024 {
                self.buf.reserve(256 * 1024);
            }
            if self.io.read_buf(&mut self.buf).await? == 0 {
                return Err(Error::Closed);
            }
        }
    }

    /// End the connection: Terminate, then the socket's write side.
    pub(crate) async fn terminate(&mut self) {
        frontend::terminate(&mut self.out);
        let _ = self.send().await;
        let _ = self.io.shutdown().await;
    }
}

/// TCP to the first of `host`'s addresses that answers, with keepalive and no Nagle delay.
async fn tcp(host: &str, port: u16) -> Result<TcpStream, Error> {
    let addresses: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|e| Error::Io(format!("cannot resolve {host}: {e}")))?
        .collect();
    let mut last = format!("{host} has no address");
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
    Err(Error::Io(format!(
        "cannot connect to {host}:{port}: {last}"
    )))
}

/// SSLRequest, one byte back (`S` or `N`), then the handshake for the mode.
async fn secure(mut tcp: TcpStream, config: &Config) -> Result<Conn, Error> {
    let mut out = BytesMut::new();
    frontend::ssl_request(&mut out);
    tcp.write_all(&out).await?;
    let mut answer = [0u8; 1];
    tcp.read_exact(&mut answer).await?;
    match answer[0] {
        b'S' => {}
        b'N' if config.tls == TlsMode::Prefer => return Ok(Conn::new(Box::new(tcp), None)),
        b'N' => {
            let mode = config.tls.name();
            return Err(Error::Io(format!(
                "the server has no TLS and the mode is {mode}"
            )));
        }
        other => return Err(protocol(format!("SSLRequest answered {other}"))),
    }
    let tls = |e: String| Error::Io(format!("TLS: {e}"));
    let client = tls::config(config.tls, config.ca_pem.as_deref()).map_err(tls)?;
    let name = tls::server_name(&config.host).map_err(tls)?;
    let stream = TlsConnector::from(client)
        .connect(name, tcp)
        .await
        .map_err(|e| tls(e.to_string()))?;
    let session = stream.get_ref().1;
    let info = TlsInfo {
        version: session
            .protocol_version()
            .and_then(|v| v.as_str())
            .unwrap_or("TLS")
            .replace('_', "."),
        cipher: session
            .negotiated_cipher_suite()
            .and_then(|s| s.suite().as_str())
            .unwrap_or("unknown")
            .to_owned(),
        end_point: session
            .peer_certificates()
            .and_then(|certs| certs.first())
            .and_then(|cert| binding::end_point(cert.as_ref())),
    };
    Ok(Conn::new(Box::new(stream), Some(info)))
}
