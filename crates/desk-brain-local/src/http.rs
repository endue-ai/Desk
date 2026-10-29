//! A small HTTP/1.1 client on std's TcpStream, written the way desk-brain-endue's is: one POST per
//! connection with a JSON body, and the answer read as text or line by line (Ollama streams
//! newline-delimited JSON), chunked or sized. Plain http only: Ollama listens on localhost.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use serde_json::Value;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// How long an answer may stay silent. The first request loads the model, which can take minutes.
const READ_TIMEOUT: Duration = Duration::from_secs(300);

/// Where the server lives: `http://host:port/prefix`.
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
                return Err("https needs TLS, which this client does not have".to_owned());
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
}

/// A response whose body has not been read yet.
pub struct Response {
    pub status: u16,
    body: Box<dyn BufRead + Send>,
}

impl Response {
    /// The whole body as text.
    pub fn text(mut self) -> io::Result<String> {
        let mut bytes = Vec::new();
        self.body.read_to_end(&mut bytes)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// The body's non-empty lines, as they arrive.
    pub fn lines(self) -> Lines {
        Lines {
            body: self.body,
            done: false,
        }
    }
}

/// POST `body` as JSON to `path`, which follows the endpoint's prefix (for example `/api/chat`).
pub fn post(endpoint: &Endpoint, path: &str, body: &Value) -> io::Result<Response> {
    let address = (endpoint.host.as_str(), endpoint.port)
        .to_socket_addrs()?
        .next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "the host has no address"))?;
    let mut stream = TcpStream::connect_timeout(&address, CONNECT_TIMEOUT)?;
    stream.set_read_timeout(Some(READ_TIMEOUT))?;
    stream.set_write_timeout(Some(CONNECT_TIMEOUT))?;

    let payload = body.to_string();
    let head = format!(
        "POST {}{path} HTTP/1.1\r\nHost: {}:{}\r\nUser-Agent: endue-desk\r\n\
         Accept: application/x-ndjson, application/json\r\nConnection: close\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\n\r\n",
        endpoint.prefix,
        endpoint.host,
        endpoint.port,
        payload.len()
    );
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
    let (mut length, mut chunked) = (None, false);
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
    Ok(Response { status, body })
}

/// Decodes `Transfer-Encoding: chunked`. A body that stops before its last chunk is an error, so a
/// stream cut short is told apart from one that ended.
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
            if self.inner.read_line(&mut line)? == 0 {
                return Err(cut_short());
            }
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
            return Err(cut_short());
        }
        self.left -= n as u64;
        if self.left == 0 {
            let mut crlf = String::new();
            self.inner.read_line(&mut crlf)?;
        }
        Ok(n)
    }
}

/// The body's lines without their line endings; empty lines are skipped. A read error ends them.
pub struct Lines {
    body: Box<dyn BufRead + Send>,
    done: bool,
}

impl Iterator for Lines {
    type Item = io::Result<String>;

    fn next(&mut self) -> Option<Self::Item> {
        while !self.done {
            let mut line = String::new();
            match self.body.read_line(&mut line) {
                Err(e) => {
                    self.done = true;
                    return Some(Err(e));
                }
                Ok(0) => self.done = true,
                Ok(_) => {}
            }
            let line = line.trim_end_matches(['\r', '\n']);
            if !line.trim().is_empty() {
                return Some(Ok(line.to_owned()));
            }
        }
        None
    }
}

fn cut_short() -> io::Error {
    io::Error::new(
        io::ErrorKind::UnexpectedEof,
        "the body ended before its last chunk",
    )
}

fn invalid(message: String) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_base_urls() {
        let endpoint = Endpoint::parse("http://127.0.0.1:11434/").unwrap();
        assert_eq!(endpoint.url(), "http://127.0.0.1:11434");
        assert_eq!(
            Endpoint::parse("http://ollama/proxy").unwrap().url(),
            "http://ollama:80/proxy"
        );
        assert!(Endpoint::parse("https://ollama.example").is_err());
        assert!(Endpoint::parse("ollama:11434").is_err());
    }

    #[test]
    fn reads_chunked_lines() {
        let raw = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n\
                   3\r\n{}\n\r\n9\r\n\n{\"a\":1}\n\r\n0\r\n\r\n";
        let response = read_response(io::Cursor::new(raw.as_bytes().to_vec())).unwrap();
        assert_eq!(response.status, 200);
        let lines: Vec<String> = response.lines().map(Result::unwrap).collect();
        assert_eq!(lines, ["{}", "{\"a\":1}"]);
    }

    #[test]
    fn a_chunked_body_cut_short_is_an_error() {
        let raw = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\n{}\n\r\n";
        let response = read_response(io::Cursor::new(raw.as_bytes().to_vec())).unwrap();
        let lines: Vec<io::Result<String>> = response.lines().collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(
            lines[1].as_ref().unwrap_err().kind(),
            io::ErrorKind::UnexpectedEof
        );
    }

    #[test]
    fn reads_sized_text() {
        let raw = "HTTP/1.1 404 Not Found\r\ncontent-length: 2\r\n\r\n{}trailing";
        let response = read_response(io::Cursor::new(raw.as_bytes().to_vec())).unwrap();
        assert_eq!(response.status, 404);
        assert_eq!(response.text().unwrap(), "{}");
    }
}
