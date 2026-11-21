//! A session over PostgreSQL's protocol 3.0: the socket (TLS after the SSLRequest byte exchange),
//! the startup message, sign-in (SCRAM-SHA-256, SCRAM-SHA-256-PLUS with channel binding, md5,
//! cleartext), the server's parameters and its cancel key. Messages come from postgres-protocol.

use std::io;
use std::time::{Duration, Instant};

use bytes::BytesMut;
use fallible_iterator::FallibleIterator;
use postgres_protocol::authentication::md5_hash;
use postgres_protocol::authentication::sasl::{ChannelBinding, ScramSha256};
use postgres_protocol::message::backend::{ErrorFields, Message};
use postgres_protocol::message::frontend;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;

use crate::conninfo::{ConnInfo, SslMode};
use crate::tls;

pub trait Io: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Io for T {}

/// Every field the server sent with an error or a notice, by its one-letter code, in order.
pub type Fields = Vec<(char, String)>;

#[derive(Debug)]
pub enum Error {
    Io(io::Error),
    Tls(String),
    Server(Fields),
    Protocol(String),
    Closed,
}

impl From<io::Error> for Error {
    fn from(e: io::Error) -> Error {
        Error::Io(e)
    }
}

impl Error {
    /// The SQLSTATE of a server error.
    pub fn code(&self) -> Option<&str> {
        match self {
            Error::Server(fields) => field(fields, 'C'),
            _ => None,
        }
    }
}

pub fn field(fields: &Fields, code: char) -> Option<&str> {
    fields
        .iter()
        .find(|(c, _)| *c == code)
        .map(|(_, v)| v.as_str())
}

pub fn fields(mut iter: ErrorFields<'_>) -> Fields {
    let mut out = Vec::new();
    while let Ok(Some(f)) = iter.next() {
        out.push((
            f.type_() as char,
            String::from_utf8_lossy(f.value_bytes()).into_owned(),
        ));
    }
    out
}

/// What arrives without being asked: notices, notifications, parameter changes.
#[derive(Debug)]
pub enum Async {
    Notice(Fields, Instant),
    Notification {
        pid: i32,
        channel: String,
        payload: String,
        at: Instant,
    },
    Parameter(String, String),
}

/// How the socket ended up: TLS version and suite, and the certificate's end-point hash.
pub struct TlsDone {
    pub version: String,
    pub suite: String,
    pub end_point: Option<Vec<u8>>,
}

pub struct Session {
    io: Box<dyn Io>,
    buf: BytesMut,
    pub info: ConnInfo,
    pub tls: Option<TlsDone>,
    /// The mechanisms the server offered and the one this session signed in with.
    pub offered: Vec<String>,
    pub mechanism: String,
    pub pid: i32,
    pub key: i32,
    pub server: Vec<(String, String)>,
    pub asyncs: Vec<Async>,
    /// From the first byte sent to ReadyForQuery.
    pub sign_in: Duration,
    /// Every byte read from the socket, after TLS.
    pub read_bytes: u64,
}

/// TCP, then TLS when the mode asks for it: SSLRequest, one byte back (`S` or `N`), the handshake.
pub async fn open_stream(info: &ConnInfo) -> Result<(Box<dyn Io>, Option<TlsDone>), Error> {
    let connect = TcpStream::connect((info.host.as_str(), info.port));
    let mut tcp = tokio::time::timeout(Duration::from_secs(10), connect)
        .await
        .map_err(|_| Error::Io(io::ErrorKind::TimedOut.into()))??;
    tcp.set_nodelay(true)?;
    if info.sslmode == SslMode::Disable {
        return Ok((Box::new(tcp), None));
    }
    let mut out = BytesMut::new();
    frontend::ssl_request(&mut out);
    tcp.write_all(&out).await?;
    let mut answer = [0u8; 1];
    tcp.read_exact(&mut answer).await?;
    match answer[0] {
        b'S' => {
            let config = tls::config(info).map_err(Error::Tls)?;
            let name = tls::server_name(&info.host).map_err(Error::Tls)?;
            let stream = TlsConnector::from(config)
                .connect(name, tcp)
                .await
                .map_err(|e| Error::Tls(e.to_string()))?;
            let conn = stream.get_ref().1;
            let done = TlsDone {
                version: format!("{:?}", conn.protocol_version().unwrap()),
                suite: format!("{:?}", conn.negotiated_cipher_suite().unwrap().suite()),
                end_point: conn
                    .peer_certificates()
                    .and_then(|c| c.first())
                    .map(tls::end_point),
            };
            Ok((Box::new(stream), Some(done)))
        }
        b'N' if info.sslmode == SslMode::Prefer => Ok((Box::new(tcp), None)),
        b'N' => Err(Error::Tls(format!(
            "the server has no TLS and sslmode is {}",
            info.sslmode
        ))),
        other => Err(Error::Protocol(format!("SSLRequest answered {other}"))),
    }
}

impl Session {
    pub async fn connect(info: &ConnInfo) -> Result<Session, Error> {
        Session::connect_with(info, &[]).await
    }

    /// Connect with extra startup parameters (`options`, `search_path`, ...).
    pub async fn connect_with(info: &ConnInfo, extra: &[(&str, &str)]) -> Result<Session, Error> {
        let started = Instant::now();
        let (io, tls) = open_stream(info).await?;
        let mut s = Session {
            io,
            buf: BytesMut::with_capacity(64 * 1024),
            info: info.clone(),
            tls,
            offered: Vec::new(),
            mechanism: "trust".to_owned(),
            pid: 0,
            key: 0,
            server: Vec::new(),
            asyncs: Vec::new(),
            sign_in: Duration::ZERO,
            read_bytes: 0,
        };
        let mut params = vec![
            ("user", info.user.as_str()),
            ("database", info.database.as_str()),
            ("application_name", "endue Desk spike"),
            ("client_encoding", "UTF8"),
            ("DateStyle", "ISO"),
        ];
        params.extend_from_slice(extra);
        let mut out = BytesMut::new();
        frontend::startup_message(params, &mut out)?;
        s.send(&out).await?;
        s.authenticate().await?;
        loop {
            match s.recv().await? {
                Message::ParameterStatus(p) => s.server.push((p.name()?.into(), p.value()?.into())),
                Message::BackendKeyData(k) => (s.pid, s.key) = (k.process_id(), k.secret_key()),
                Message::ReadyForQuery(_) => break,
                Message::NoticeResponse(n) => s
                    .asyncs
                    .push(Async::Notice(fields(n.fields()), Instant::now())),
                Message::ErrorResponse(e) => return Err(Error::Server(fields(e.fields()))),
                _ => return Err(Error::Protocol("unexpected message after sign-in".into())),
            }
        }
        s.sign_in = started.elapsed();
        Ok(s)
    }

    async fn authenticate(&mut self) -> Result<(), Error> {
        let password = self.info.password.clone();
        let mut scram: Option<ScramSha256> = None;
        loop {
            let mut out = BytesMut::new();
            match self.recv().await? {
                Message::AuthenticationOk => return Ok(()),
                Message::AuthenticationCleartextPassword => {
                    self.mechanism = "password".into();
                    frontend::password_message(password.as_bytes(), &mut out)?;
                }
                Message::AuthenticationMd5Password(body) => {
                    self.mechanism = "md5".into();
                    let hash =
                        md5_hash(self.info.user.as_bytes(), password.as_bytes(), body.salt());
                    frontend::password_message(hash.as_bytes(), &mut out)?;
                }
                Message::AuthenticationSasl(body) => {
                    self.offered = body.mechanisms().map(|m| Ok(m.to_owned())).collect()?;
                    let plus = self.offered.iter().any(|m| m == "SCRAM-SHA-256-PLUS");
                    let end_point = self.tls.as_ref().and_then(|t| t.end_point.clone());
                    let (mechanism, binding) = match end_point {
                        Some(hash) if plus => (
                            "SCRAM-SHA-256-PLUS",
                            ChannelBinding::tls_server_end_point(hash),
                        ),
                        Some(_) => ("SCRAM-SHA-256", ChannelBinding::unrequested()),
                        None => ("SCRAM-SHA-256", ChannelBinding::unsupported()),
                    };
                    self.mechanism = mechanism.into();
                    let client = ScramSha256::new(password.as_bytes(), binding);
                    frontend::sasl_initial_response(mechanism, client.message(), &mut out)?;
                    scram = Some(client);
                }
                Message::AuthenticationSaslContinue(body) => {
                    let client = scram
                        .as_mut()
                        .ok_or(Error::Protocol("SASL without a start".into()))?;
                    client.update(body.data())?;
                    frontend::sasl_response(client.message(), &mut out)?;
                }
                Message::AuthenticationSaslFinal(body) => {
                    let client = scram
                        .as_mut()
                        .ok_or(Error::Protocol("SASL without a start".into()))?;
                    client.finish(body.data())?;
                    continue;
                }
                Message::ErrorResponse(e) => return Err(Error::Server(fields(e.fields()))),
                _ => return Err(Error::Protocol("a sign-in the spike does not speak".into())),
            }
            self.send(&out).await?;
        }
    }

    pub async fn send(&mut self, bytes: &[u8]) -> Result<(), Error> {
        self.io.write_all(bytes).await?;
        self.io.flush().await?;
        Ok(())
    }

    /// The next message from the server, whatever it is.
    pub async fn recv(&mut self) -> Result<Message, Error> {
        loop {
            if let Some(message) = Message::parse(&mut self.buf)? {
                return Ok(message);
            }
            if self.buf.capacity() - self.buf.len() < 16 * 1024 {
                self.buf.reserve(256 * 1024);
            }
            match self.io.read_buf(&mut self.buf).await? {
                0 => return Err(Error::Closed),
                n => self.read_bytes += n as u64,
            }
        }
    }

    /// The next message that answers what was sent; notices, notifications and parameter changes
    /// are kept in `asyncs` with the time they arrived.
    pub async fn answer(&mut self) -> Result<Message, Error> {
        loop {
            match self.recv().await? {
                Message::NoticeResponse(n) => self
                    .asyncs
                    .push(Async::Notice(fields(n.fields()), Instant::now())),
                Message::NotificationResponse(n) => self.asyncs.push(Async::Notification {
                    pid: n.process_id(),
                    channel: n.channel()?.to_owned(),
                    payload: n.message()?.to_owned(),
                    at: Instant::now(),
                }),
                Message::ParameterStatus(p) => self
                    .asyncs
                    .push(Async::Parameter(p.name()?.into(), p.value()?.into())),
                other => return Ok(other),
            }
        }
    }

    pub async fn terminate(mut self) -> Result<(), Error> {
        let mut out = BytesMut::new();
        frontend::terminate(&mut out);
        self.send(&out).await?;
        self.io.shutdown().await?;
        Ok(())
    }
}

/// A cancel request on a connection of its own, over TLS when the session's mode asks for it;
/// the server answers nothing and closes it.
pub async fn cancel(info: &ConnInfo, pid: i32, key: i32) -> Result<(), Error> {
    let (mut io, _) = open_stream(info).await?;
    let mut out = BytesMut::new();
    frontend::cancel_request(pid, key, &mut out);
    io.write_all(&out).await?;
    io.flush().await?;
    let mut rest = Vec::new();
    let _ = io.read_to_end(&mut rest).await;
    Ok(())
}
