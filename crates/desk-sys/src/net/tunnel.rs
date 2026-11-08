//! Byte streams to a WebSocket server: TCP, direct or through an HTTP proxy (CONNECT) or a SOCKS5
//! proxy without authentication, then TLS for wss over rustls with the OS trust store, the same
//! ring provider and verifier as fetch.

use std::io::{self, Read, Write};
use std::net::{IpAddr, Shutdown, SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::{Arc, OnceLock};
use std::time::Instant;

use rustls::pki_types::ServerName;
use rustls::{ClientConfig, ClientConnection, StreamOwned};
use rustls_platform_verifier::BuilderVerifierExt;
use url::Url;

use super::proxy::{self, Route};
use crate::{Error, ErrorCode};

/// A connection to the server, through any proxy, in TLS for wss.
pub(super) enum Conn {
    Plain(TcpStream),
    Tls(Box<StreamOwned<ClientConnection, TcpStream>>),
}

impl Conn {
    /// The TCP socket under it.
    pub(super) fn tcp(&self) -> &TcpStream {
        match self {
            Conn::Plain(tcp) => tcp,
            Conn::Tls(tls) => tls.get_ref(),
        }
    }
}

impl Read for Conn {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match self {
            Conn::Plain(tcp) => tcp.read(buf),
            Conn::Tls(tls) => tls.read(buf),
        }
    }
}

impl Write for Conn {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match self {
            Conn::Plain(tcp) => tcp.write(buf),
            Conn::Tls(tls) => tls.write(buf),
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        match self {
            Conn::Plain(tcp) => tcp.flush(),
            Conn::Tls(tls) => tls.flush(),
        }
    }
}

/// Connect to `url`'s server by `route` before `deadline`, then start TLS for wss. Reads and writes
/// time out at the deadline until the caller sets other timeouts.
pub(super) fn open(url: &Url, route: &Route, deadline: Option<Instant>) -> Result<Conn, Error> {
    let host = url.host_str().unwrap_or_default();
    let port = url.port_or_known_default().unwrap_or(80);
    let tcp = match route {
        Route::Direct => connect(host, port, deadline)?,
        Route::Proxy(proxy) => through(proxy, host, port, deadline)?,
    };
    if url.scheme() != "wss" {
        return Ok(Conn::Plain(tcp));
    }
    let name = ServerName::try_from(bare(host).to_owned())
        .map_err(|err| Error::new(ErrorCode::InvalidParams, format!("{url}: {err}")))?;
    let tls = ClientConnection::new(tls_config()?, name)
        .map_err(|err| Error::new(ErrorCode::IoError, format!("{url}: TLS: {err}")))?;
    let mut stream = StreamOwned::new(tls, tcp);
    while stream.conn.is_handshaking() {
        stream
            .conn
            .complete_io(&mut stream.sock)
            .map_err(|err| failed(&err, format!("{url}: the TLS handshake")))?;
    }
    Ok(Conn::Tls(Box::new(stream)))
}

/// A TCP connection to `host:port`, trying each address until one answers.
fn connect(host: &str, port: u16, deadline: Option<Instant>) -> Result<TcpStream, Error> {
    let target = format!("{host}:{port}");
    let addrs: Vec<SocketAddr> = match bare(host).parse::<IpAddr>() {
        Ok(ip) => vec![SocketAddr::new(ip, port)],
        Err(_) => (host, port)
            .to_socket_addrs()
            .map_err(|err| Error::io(&err, &target))?
            .collect(),
    };
    let mut last = io::Error::new(io::ErrorKind::NotFound, "no address");
    for addr in addrs {
        let attempt = match super::left(deadline, &target)? {
            Some(left) => TcpStream::connect_timeout(&addr, left),
            None => TcpStream::connect(addr),
        };
        match attempt {
            Ok(tcp) => {
                let left = super::left(deadline, &target)?;
                tcp.set_read_timeout(left)
                    .map_err(|err| Error::io(&err, &target))?;
                tcp.set_write_timeout(left)
                    .map_err(|err| Error::io(&err, &target))?;
                let _ = tcp.set_nodelay(true);
                return Ok(tcp);
            }
            Err(err) => last = err,
        }
    }
    Err(failed(&last, target))
}

/// Through the proxy at `proxy`: http (CONNECT) or socks5 / socks5h without credentials.
fn through(
    proxy: &str,
    host: &str,
    port: u16,
    deadline: Option<Instant>,
) -> Result<TcpStream, Error> {
    let shown = proxy::shown(proxy);
    let url = Url::parse(proxy)
        .map_err(|err| Error::new(ErrorCode::IoError, format!("the proxy {shown}: {err}")))?;
    let proxy_host = url.host_str().unwrap_or_default();
    let refused = |why: String| Error::new(ErrorCode::IoError, format!("the proxy {shown}: {why}"));
    match url.scheme() {
        "http" => {
            let mut tcp = connect(proxy_host, url.port().unwrap_or(80), deadline)?;
            let mut head = format!("CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n");
            if !url.username().is_empty() || url.password().is_some() {
                let user = decode(url.username());
                let password = decode(url.password().unwrap_or_default());
                let credentials = base64(format!("{user}:{password}").as_bytes());
                head.push_str(&format!("Proxy-Authorization: Basic {credentials}\r\n"));
            }
            head.push_str("\r\n");
            tcp.write_all(head.as_bytes())
                .map_err(|err| failed(&err, &shown))?;
            let answer = read_head(&mut tcp).map_err(|err| failed(&err, &shown))?;
            let status = answer.lines().next().unwrap_or_default();
            match status.split_whitespace().nth(1) {
                Some(code) if code.starts_with('2') => Ok(tcp),
                _ => Err(refused(format!("answered {status:?}"))),
            }
        }
        "socks5" | "socks5h" if url.username().is_empty() && url.password().is_none() => {
            let mut tcp = connect(proxy_host, url.port().unwrap_or(1080), deadline)?;
            let resolve = url.scheme() == "socks5";
            socks5(&mut tcp, host, port, resolve).map_err(|err| refused(err.to_string()))?;
            Ok(tcp)
        }
        other => Err(Error::new(
            ErrorCode::Unsupported,
            format!(
                "a WebSocket cannot go through the proxy {shown} ({other}, credentials or not)"
            ),
        )),
    }
}

/// The SOCKS5 handshake without authentication; `resolve` looks the host up here first.
fn socks5(tcp: &mut TcpStream, host: &str, port: u16, resolve: bool) -> io::Result<()> {
    tcp.write_all(&[5, 1, 0])?;
    let mut answer = [0u8; 2];
    tcp.read_exact(&mut answer)?;
    if answer != [5, 0] {
        return Err(io::Error::other("it wants authentication"));
    }
    let ip = match bare(host).parse::<IpAddr>() {
        Ok(ip) => Some(ip),
        Err(_) if resolve => (host, port).to_socket_addrs()?.next().map(|addr| addr.ip()),
        Err(_) => None,
    };
    let mut request = vec![5, 1, 0];
    match ip {
        Some(IpAddr::V4(ip)) => {
            request.push(1);
            request.extend(ip.octets());
        }
        Some(IpAddr::V6(ip)) => {
            request.push(4);
            request.extend(ip.octets());
        }
        None => {
            let name = u8::try_from(host.len()).map_err(|_| io::Error::other("host too long"))?;
            request.extend([3, name]);
            request.extend(host.as_bytes());
        }
    }
    request.extend(port.to_be_bytes());
    tcp.write_all(&request)?;
    let mut reply = [0u8; 4];
    tcp.read_exact(&mut reply)?;
    if reply[1] != 0 {
        return Err(io::Error::other(format!(
            "it refused with code {}",
            reply[1]
        )));
    }
    let skip = match reply[3] {
        1 => 4,
        4 => 16,
        3 => {
            let mut len = [0u8; 1];
            tcp.read_exact(&mut len)?;
            usize::from(len[0])
        }
        _ => return Err(io::Error::other("a bad address type")),
    };
    tcp.read_exact(&mut vec![0u8; skip + 2])
}

/// An HTTP head, one byte at a time so nothing after it is read; at most 16 KiB.
fn read_head(tcp: &mut TcpStream) -> io::Result<String> {
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if head.len() > 16 * 1024 {
            return Err(io::Error::other("an answer head over 16 KiB"));
        }
        if tcp.read(&mut byte)? == 0 {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        head.push(byte[0]);
    }
    Ok(String::from_utf8_lossy(&head).into_owned())
}

fn tls_config() -> Result<Arc<ClientConfig>, Error> {
    static CONFIG: OnceLock<Result<Arc<ClientConfig>, String>> = OnceLock::new();
    CONFIG
        .get_or_init(|| {
            let provider = Arc::new(rustls::crypto::ring::default_provider());
            ClientConfig::builder_with_provider(provider)
                .with_safe_default_protocol_versions()
                .and_then(|builder| builder.with_platform_verifier())
                .map(|builder| Arc::new(builder.with_no_client_auth()))
                .map_err(|err| err.to_string())
        })
        .clone()
        .map_err(|err| Error::new(ErrorCode::IoError, format!("TLS: {err}")))
}

/// Shut the socket down both ways, ending a read blocked on it.
pub(super) fn shutdown(tcp: &TcpStream) {
    let _ = tcp.shutdown(Shutdown::Both);
}

/// An I/O failure while connecting: `timeout` when a deadline ran out, `io_error` otherwise.
pub(super) fn failed(err: &io::Error, context: impl std::fmt::Display) -> Error {
    match err.kind() {
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => {
            Error::new(ErrorCode::Timeout, format!("{context}: timed out"))
        }
        _ => Error::new(ErrorCode::IoError, format!("{context}: {err}")),
    }
}

/// An IPv6 host without its brackets.
fn bare(host: &str) -> &str {
    host.trim_start_matches('[').trim_end_matches(']')
}

/// Percent-decoding of a URL's user or password.
fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = bytes
            .get(i + 1..i + 3)
            .and_then(|h| std::str::from_utf8(h).ok());
        match (bytes[i], hex.and_then(|h| u8::from_str_radix(h, 16).ok())) {
            (b'%', Some(byte)) => {
                out.push(byte);
                i += 3;
            }
            (byte, _) => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Standard base64 with padding.
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, &b)| n | u32::from(b) << (16 - 8 * i));
        for i in 0..4 {
            match i <= chunk.len() {
                true => out.push(char::from(ALPHABET[(n >> (18 - 6 * i) & 63) as usize])),
                false => out.push('='),
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_are_decoded_and_encoded() {
        assert_eq!(decode("us%40er"), "us@er");
        assert_eq!(decode("100%"), "100%");
        assert_eq!(base64(b"user:pass"), "dXNlcjpwYXNz");
        assert_eq!(base64(b"ab"), "YWI=");
        assert_eq!(base64(b"a"), "YQ==");
        assert_eq!(base64(b""), "");
    }
}
