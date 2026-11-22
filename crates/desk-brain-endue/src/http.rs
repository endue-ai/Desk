//! A small HTTP/1.1 client on std's TcpStream: one request per connection, JSON bodies, chunked or
//! sized responses and Server-Sent Events. An https endpoint goes over TLS instead (`tls.rs`).

use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use serde_json::Value;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// How long a response may stay silent; turn streams send events well within it.
const READ_TIMEOUT: Duration = Duration::from_secs(60);

/// Where a brain lives: `http://host:port/prefix` or `https://host:port/prefix`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    secure: bool,
    host: String,
    port: u16,
    prefix: String,
}

impl Endpoint {
    pub fn parse(base_url: &str) -> Result<Self, String> {
        if base_url
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte == b' ')
        {
            return Err("invalid characters in the brain URL".into());
        }
        let url = url::Url::parse(base_url).map_err(|_| "invalid brain URL")?;
        let secure = match url.scheme() {
            "https" => true,
            "http" => false,
            _ => return Err("expected an HTTP or HTTPS brain URL".into()),
        };
        if !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(
                "the brain base URL cannot contain credentials, a query or a fragment".into(),
            );
        }
        let host = match url.host().ok_or("missing brain host")? {
            url::Host::Ipv6(ip) => ip.to_string(),
            host => host.to_string(),
        };
        Ok(Self {
            secure,
            host,
            port: url.port_or_known_default().ok_or("missing brain port")?,
            prefix: url.path().trim_end_matches('/').to_owned(),
        })
    }

    fn authority(&self) -> String {
        if self.host.contains(':') {
            format!("[{}]:{}", self.host, self.port)
        } else {
            format!("{}:{}", self.host, self.port)
        }
    }

    pub fn url(&self) -> String {
        let scheme = if self.secure { "https" } else { "http" };
        format!("{scheme}://{}{}", self.authority(), self.prefix)
    }

    pub(crate) fn is_loopback(&self) -> bool {
        self.host == "localhost"
            || self
                .host
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    }

    pub fn is_secure(&self) -> bool {
        self.secure
    }
}

/// A response whose body has not been read yet.
pub struct Response {
    pub status: u16,
    content_type: String,
    body: Box<dyn BufRead + Send>,
}

impl Response {
    pub(crate) fn new(status: u16, content_type: String, body: Box<dyn BufRead + Send>) -> Self {
        Self {
            status,
            content_type,
            body,
        }
    }

    pub fn is_event_stream(&self) -> bool {
        self.content_type.starts_with("text/event-stream")
    }

    /// The body as JSON; `Value::Null` when it is empty.
    pub fn json(mut self) -> io::Result<Value> {
        let mut bytes = Vec::new();
        self.body.read_to_end(&mut bytes)?;
        if bytes.iter().all(u8::is_ascii_whitespace) {
            return Ok(Value::Null);
        }
        serde_json::from_slice(&bytes).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
    }

    /// The data of each Server-Sent Event, as it arrives.
    pub fn events(self) -> Events {
        Events {
            body: self.body,
            done: false,
        }
    }
}

/// Send one request. `path` follows the endpoint's prefix, for example `/sessions`.
pub fn send(
    endpoint: &Endpoint,
    token: Option<&str>,
    method: &str,
    path: &str,
    body: Option<&Value>,
) -> io::Result<Response> {
    if endpoint.secure {
        return crate::tls::send(endpoint, token, method, path, body);
    }
    // localhost and multi-address services may listen on just one address family.
    let mut last_error = io::Error::new(io::ErrorKind::NotFound, "the host has no address");
    let mut stream = (endpoint.host.as_str(), endpoint.port)
        .to_socket_addrs()?
        .find_map(
            |address| match TcpStream::connect_timeout(&address, CONNECT_TIMEOUT) {
                Ok(stream) => Some(stream),
                Err(error) => {
                    last_error = error;
                    None
                }
            },
        )
        .ok_or(last_error)?;
    stream.set_read_timeout(Some(READ_TIMEOUT))?;
    stream.set_write_timeout(Some(CONNECT_TIMEOUT))?;

    let payload = body.map(|b| b.to_string()).unwrap_or_default();
    let mut head = format!(
        "{method} {}{path} HTTP/1.1\r\nHost: {}\r\nUser-Agent: endue-desk\r\n\
         Accept: application/json, text/event-stream\r\nConnection: close\r\n",
        endpoint.prefix,
        endpoint.authority()
    );
    if let Some(token) = token {
        head.push_str(&format!("Authorization: Bearer {token}\r\n"));
    }
    if body.is_some() {
        head.push_str("Content-Type: application/json\r\n");
    }
    head.push_str(&format!("Content-Length: {}\r\n\r\n", payload.len()));
    stream.write_all(head.as_bytes())?;
    stream.write_all(payload.as_bytes())?;
    stream.flush()?;
    read_response(BufReader::new(stream))
}

fn read_response<R: BufRead + Send + 'static>(mut reader: R) -> io::Result<Response> {
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let status = line
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse().ok())
        .ok_or_else(|| invalid(format!("not an HTTP status line: {line:?}")))?;
    let (mut length, mut chunked, mut content_type) = (None, false, String::new());
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 || line.trim().is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            let value = value.trim();
            match name.trim().to_ascii_lowercase().as_str() {
                "content-length" => length = value.parse::<u64>().ok(),
                "transfer-encoding" => chunked = value.eq_ignore_ascii_case("chunked"),
                "content-type" => content_type = value.to_ascii_lowercase(),
                _ => {}
            }
        }
    }
    let body: Box<dyn BufRead + Send> = if chunked {
        Box::new(BufReader::new(Chunked {
            inner: reader,
            left: 0,
            done: false,
        }))
    } else if let Some(length) = length {
        Box::new(reader.take(length))
    } else {
        Box::new(reader)
    };
    Ok(Response {
        status,
        content_type,
        body,
    })
}

/// Decodes `Transfer-Encoding: chunked`.
struct Chunked<R> {
    inner: R,
    left: u64,
    done: bool,
}

impl<R: BufRead> Read for Chunked<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.done || buf.is_empty() {
            return Ok(0);
        }
        if self.left == 0 {
            let mut line = String::new();
            self.inner.read_line(&mut line)?;
            let size = line.trim().split(';').next().unwrap_or_default();
            self.left = u64::from_str_radix(size, 16)
                .map_err(|_| invalid(format!("not a chunk size: {line:?}")))?;
            if self.left == 0 {
                // Trailers, then the empty line that ends the body.
                while self.inner.read_line(&mut line)? > 0 && !line.trim().is_empty() {
                    line.clear();
                }
                self.done = true;
                return Ok(0);
            }
        }
        let max = buf
            .len()
            .min(usize::try_from(self.left).unwrap_or(usize::MAX));
        let n = self.inner.read(&mut buf[..max])?;
        if n == 0 {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        self.left -= n as u64;
        if self.left == 0 {
            let mut crlf = String::new();
            self.inner.read_line(&mut crlf)?;
        }
        Ok(n)
    }
}

/// Server-Sent Events: each item is one event's data lines, joined with newlines.
pub struct Events {
    body: Box<dyn BufRead + Send>,
    done: bool,
}

impl Iterator for Events {
    type Item = io::Result<String>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.done {
            return None;
        }
        let mut data: Option<String> = None;
        loop {
            let mut line = String::new();
            match self.body.read_line(&mut line) {
                Err(e) => {
                    self.done = true;
                    return Some(Err(e));
                }
                Ok(0) => {
                    self.done = true;
                    return data.map(Ok);
                }
                Ok(_) => {}
            }
            let line = line.trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                if let Some(data) = data.take() {
                    return Some(Ok(data));
                }
            } else if let Some(rest) = line.strip_prefix("data:") {
                let rest = rest.strip_prefix(' ').unwrap_or(rest);
                match &mut data {
                    Some(data) => {
                        data.push('\n');
                        data.push_str(rest);
                    }
                    None => data = Some(rest.to_owned()),
                }
            }
        }
    }
}

fn invalid(message: String) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_base_urls() {
        let endpoint = Endpoint::parse("http://127.0.0.1:8787/v0/").unwrap();
        assert_eq!(endpoint.url(), "http://127.0.0.1:8787/v0");
        assert_eq!(
            Endpoint::parse("http://brain").unwrap().url(),
            "http://brain:80"
        );
        let secure = Endpoint::parse("https://endue.ai/v0").unwrap();
        assert!(secure.is_secure());
        assert_eq!(secure.url(), "https://endue.ai:443/v0");
        assert!(Endpoint::parse("ftp://x").is_err());
        assert_eq!(
            Endpoint::parse("http://[::1]/v0").unwrap().url(),
            "http://[::1]:80/v0"
        );
        assert!(Endpoint::parse("https://brain.example.test/v0?token=fixture-only").is_err());
    }

    #[test]
    fn reads_chunked_event_streams() {
        let raw = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n\
                   a\r\ndata: {}\n\n\r\n11\r\ndata: a\ndata: b\n\n\r\n0\r\n\r\n";
        let response = read_response(io::Cursor::new(raw.as_bytes().to_vec())).unwrap();
        assert!(response.is_event_stream());
        let events: Vec<String> = response.events().map(Result::unwrap).collect();
        assert_eq!(events, ["{}", "a\nb"]);
    }

    #[test]
    fn reads_sized_json() {
        let raw = "HTTP/1.1 409 Conflict\r\ncontent-length: 2\r\n\r\n{}trailing";
        let response = read_response(io::Cursor::new(raw.as_bytes().to_vec())).unwrap();
        assert_eq!(response.status, 409);
        assert_eq!(response.json().unwrap(), serde_json::json!({}));
    }
}
