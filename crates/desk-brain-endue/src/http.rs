//! A small HTTP/1.1 client on std's TcpStream: one request per connection, JSON bodies, chunked or
//! sized responses and Server-Sent Events. Plain http only; TLS arrives with the real endue AI.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use serde_json::Value;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// How long a response may stay silent; turn streams send events well within it.
const READ_TIMEOUT: Duration = Duration::from_secs(60);

/// Where a brain lives: `http://host:port/prefix`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoint {
    host: String,
    port: u16,
    prefix: String,
}

impl Endpoint {
    pub fn parse(base_url: &str) -> Result<Self, String> {
        let rest = match base_url.split_once("://") {
            Some(("http", rest)) => rest,
            Some(("https", _)) => {
                return Err("https needs TLS, which this client does not have yet".to_owned());
            }
            _ => return Err(format!("not an http URL: {base_url}")),
        };
        let (authority, path) = rest.split_at(rest.find('/').unwrap_or(rest.len()));
        let (host, port) = match authority.rsplit_once(':') {
            Some((host, port)) => (
                host,
                port.parse()
                    .map_err(|_| format!("not a port: {port} in {base_url}"))?,
            ),
            None => (authority, 80),
        };
        if host.is_empty() {
            return Err(format!("no host in {base_url}"));
        }
        Ok(Self {
            host: host.to_owned(),
            port,
            prefix: path.trim_end_matches('/').to_owned(),
        })
    }

    pub fn url(&self) -> String {
        format!("http://{}:{}{}", self.host, self.port, self.prefix)
    }

    /// The same host and port without the path: `http://127.0.0.1:8787/v0` gives
    /// `http://127.0.0.1:8787`.
    pub fn origin(&self) -> Self {
        Self {
            prefix: String::new(),
            ..self.clone()
        }
    }
}

/// A response whose body has not been read yet.
pub struct Response {
    pub status: u16,
    content_type: String,
    body: Box<dyn BufRead + Send>,
}

impl Response {
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
    let address = (endpoint.host.as_str(), endpoint.port)
        .to_socket_addrs()?
        .next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "the host has no address"))?;
    let mut stream = TcpStream::connect_timeout(&address, CONNECT_TIMEOUT)?;
    stream.set_read_timeout(Some(READ_TIMEOUT))?;
    stream.set_write_timeout(Some(CONNECT_TIMEOUT))?;

    let payload = body.map(|b| b.to_string()).unwrap_or_default();
    let mut head = format!(
        "{method} {}{path} HTTP/1.1\r\nHost: {}:{}\r\nUser-Agent: endue-desk\r\n\
         Accept: application/json, text/event-stream\r\nConnection: close\r\n",
        endpoint.prefix, endpoint.host, endpoint.port
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
        assert!(Endpoint::parse("https://endue.ai/v0").is_err());
        assert!(Endpoint::parse("ftp://x").is_err());
        let brain = Endpoint::parse("http://127.0.0.1:8787/v0").unwrap();
        assert_eq!(brain.origin().url(), "http://127.0.0.1:8787");
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
