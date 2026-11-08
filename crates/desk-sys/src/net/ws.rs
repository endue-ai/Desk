//! WebSocket streams over tungstenite: the handshake and its redirects checked against the host
//! allowlist like fetch's, then text and binary messages both ways, read on the socket's own thread.

use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use tungstenite::client::IntoClientRequest;
use tungstenite::handshake::HandshakeError;
use tungstenite::http::{HeaderName, HeaderValue};
use tungstenite::protocol::WebSocketConfig;
use url::Url;

use super::tunnel::{self, Conn};
use super::{MAX_BODY_BYTES, MAX_REDIRECTS, hosts, proxy};
use crate::{Error, ErrorCode};

mod socket;
pub use socket::Socket;

/// One socket to open.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Request {
    /// A ws or wss URL.
    pub url: String,
    /// Sent with the handshake. The headers the handshake owns (`Host`, `Upgrade`, `Connection`,
    /// `Sec-WebSocket-*`) are `invalid_params`.
    pub headers: BTreeMap<String, String>,
    /// Subprotocols offered as `Sec-WebSocket-Protocol`; the server's choice is `Socket::protocol`.
    pub protocols: Vec<String>,
    /// For the handshake, redirects included; never for the messages.
    pub timeout: Option<Duration>,
    /// Host patterns (bridge `HostPattern`) that every URL of the call must match.
    pub allowed_hosts: Vec<String>,
}

/// A message, at most `MAX_BODY_BYTES`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Message {
    Text(String),
    Binary(Vec<u8>),
}

/// What a socket reports, in order. `Closed` comes once and last.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Message(Message),
    /// The end, with the close frame's code and reason: 1005 when the frame had no code, 1006 (and
    /// the failure as the reason) when the connection ended without one.
    Closed {
        code: u16,
        reason: String,
    },
}

/// Open a socket: connect (through the proxy `proxy` chooses for the URL), handshake, and follow
/// 301, 302, 303, 307 and 308 answers (at most `MAX_REDIRECTS`; http and https Locations become ws
/// and wss), checking each URL against `allowed_hosts` before connecting. `on_event` runs on the
/// socket's own thread and is dropped after `Closed`.
pub fn connect(
    request: &Request,
    on_event: impl FnMut(Event) + Send + 'static,
) -> Result<Socket, Error> {
    let deadline = request.timeout.map(|timeout| Instant::now() + timeout);
    let mut url = parse(&request.url)?;
    let mut headers = request.headers.clone();
    check(&headers, &request.protocols)?;
    for _ in 0..=MAX_REDIRECTS {
        hosts::check(&request.allowed_hosts, &url, &request.url)?;
        super::left(deadline, &request.url)?;
        let route = proxy::resolver().route(url.as_str());
        let conn = tunnel::open(&url, &route, deadline)?;
        match handshake(conn, &url, &headers, &request.protocols)? {
            Shook::Open(socket, protocol) => return Socket::start(*socket, protocol, on_event),
            Shook::Redirect(location) => {
                let next = super::follow(&url, &location, |next| parse(&as_ws(next)))?;
                super::redirect_headers(&mut headers, &url, &next);
                url = next;
            }
        }
    }
    Err(Error::new(
        ErrorCode::IoError,
        format!("{}: more than {MAX_REDIRECTS} redirects", request.url),
    ))
}

fn parse(text: &str) -> Result<Url, Error> {
    super::parse_as(text, &["ws", "wss"], "opened as WebSockets")
}

/// An http or https redirect target as ws or wss.
fn as_ws(url: &str) -> String {
    for (from, to) in [("http://", "ws://"), ("https://", "wss://")] {
        if url.len() >= from.len() && url[..from.len()].eq_ignore_ascii_case(from) {
            return format!("{to}{}", &url[from.len()..]);
        }
    }
    url.to_owned()
}

/// Headers and subprotocols the handshake can send.
fn check(headers: &BTreeMap<String, String>, protocols: &[String]) -> Result<(), Error> {
    let invalid = |why: String| Error::new(ErrorCode::InvalidParams, why);
    for (name, value) in headers {
        let lower = name.to_ascii_lowercase();
        if ["host", "upgrade", "connection"].contains(&lower.as_str())
            || lower.starts_with("sec-websocket-")
        {
            return Err(invalid(format!("the handshake sets {name:?} itself")));
        }
        if HeaderName::from_bytes(name.as_bytes()).is_err() || HeaderValue::from_str(value).is_err()
        {
            return Err(invalid(format!("bad header {name:?}")));
        }
    }
    for protocol in protocols {
        let token = !protocol.is_empty()
            && protocol
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b));
        if !token {
            return Err(invalid(format!("{protocol:?} is not a subprotocol name")));
        }
    }
    Ok(())
}

enum Shook {
    Open(Box<tungstenite::WebSocket<Conn>>, Option<String>),
    Redirect(String),
}

fn handshake(
    conn: Conn,
    url: &Url,
    headers: &BTreeMap<String, String>,
    protocols: &[String],
) -> Result<Shook, Error> {
    let invalid =
        |err: tungstenite::Error| Error::new(ErrorCode::InvalidParams, format!("{url}: {err}"));
    let mut handshake = url.as_str().into_client_request().map_err(invalid)?;
    for (name, value) in headers {
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|err| Error::new(ErrorCode::InvalidParams, format!("{name:?}: {err}")))?;
        let value = HeaderValue::from_str(value)
            .map_err(|err| Error::new(ErrorCode::InvalidParams, format!("{name}: {err}")))?;
        handshake.headers_mut().insert(name, value);
    }
    if !protocols.is_empty() {
        let offered = HeaderValue::from_str(&protocols.join(", "))
            .map_err(|err| Error::new(ErrorCode::InvalidParams, format!("{url}: {err}")))?;
        handshake
            .headers_mut()
            .insert("sec-websocket-protocol", offered);
    }
    let limit = usize::try_from(MAX_BODY_BYTES).unwrap_or(usize::MAX);
    let config = WebSocketConfig::default()
        .max_message_size(Some(limit))
        .max_frame_size(Some(limit));
    match tungstenite::client::client_with_config(handshake, conn, Some(config)) {
        Ok((socket, response)) => {
            let protocol = response
                .headers()
                .get("sec-websocket-protocol")
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            Ok(Shook::Open(Box::new(socket), protocol))
        }
        Err(HandshakeError::Failure(tungstenite::Error::Http(response))) => {
            let status = response.status().as_u16();
            let location = response
                .headers()
                .get("location")
                .map(|value| String::from_utf8_lossy(value.as_bytes()).into_owned());
            match (status, location) {
                (301 | 302 | 303 | 307 | 308, Some(location)) => Ok(Shook::Redirect(location)),
                _ => Err(Error::new(
                    ErrorCode::IoError,
                    format!("{url}: the server answered {status} instead of upgrading"),
                )),
            }
        }
        Err(HandshakeError::Failure(tungstenite::Error::Io(err))) => {
            Err(tunnel::failed(&err, format!("{url}: the handshake")))
        }
        Err(HandshakeError::Interrupted(_)) => Err(Error::new(
            ErrorCode::Timeout,
            format!("{url}: the handshake timed out"),
        )),
        Err(HandshakeError::Failure(err)) => Err(Error::new(
            ErrorCode::IoError,
            format!("{url}: the handshake: {err}"),
        )),
    }
}
