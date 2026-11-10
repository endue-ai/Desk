//! Lines on a native plugin's surface connection: one JSON text per `\n`-terminated UTF-8 line, at
//! most [`MOST_LINE`] bytes. A reader keeps a partial line across read timeouts, so a plugin can wait
//! for messages and draw between them.

use std::io::{self, BufRead, BufReader, ErrorKind, Read};

use serde::Serialize;

pub use crate::env::MOST_LINE;
use crate::{CompositorMessage, SurfaceMessage};

/// What one look at the connection found.
#[derive(Debug)]
pub enum Next {
    /// A whole line, without its `\n`.
    Line(String),
    /// Nothing came before the read timeout.
    Idle,
    /// The other side closed the connection.
    Closed,
}

/// Reads lines from `R`.
pub struct LineReader<R: Read> {
    inner: BufReader<R>,
    partial: Vec<u8>,
}

impl<R: Read> LineReader<R> {
    pub fn new(inner: R) -> Self {
        LineReader {
            inner: BufReader::new(inner),
            partial: Vec::new(),
        }
    }

    /// The next line. A line longer than [`MOST_LINE`] or not UTF-8 is an `InvalidData` error.
    pub fn next_line(&mut self) -> io::Result<Next> {
        loop {
            let available = match self.inner.fill_buf() {
                Ok(bytes) => bytes,
                Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                    return Ok(Next::Idle);
                }
                Err(e) if e.kind() == ErrorKind::Interrupted => continue,
                Err(e) => return Err(e),
            };
            if available.is_empty() {
                return Ok(Next::Closed);
            }
            let (taken, done) = match available.iter().position(|b| *b == b'\n') {
                Some(at) => (at + 1, true),
                None => (available.len(), false),
            };
            self.partial.extend_from_slice(&available[..taken]);
            self.inner.consume(taken);
            if self.partial.len() > MOST_LINE {
                self.partial.clear();
                return Err(io::Error::new(ErrorKind::InvalidData, "a line is too long"));
            }
            if done {
                let mut line = std::mem::take(&mut self.partial);
                line.pop();
                return String::from_utf8(line)
                    .map(Next::Line)
                    .map_err(|_| io::Error::new(ErrorKind::InvalidData, "a line is not UTF-8"));
            }
        }
    }

    /// The reader underneath, for its timeouts.
    pub fn get_ref(&self) -> &R {
        self.inner.get_ref()
    }
}

/// `message` as one line, `\n` included; refused past [`MOST_LINE`].
pub fn line<T: Serialize>(message: &T) -> io::Result<Vec<u8>> {
    let mut bytes =
        serde_json::to_vec(message).map_err(|e| io::Error::new(ErrorKind::InvalidInput, e))?;
    bytes.push(b'\n');
    if bytes.len() > MOST_LINE {
        return Err(io::Error::new(
            ErrorKind::InvalidInput,
            "the message is too long",
        ));
    }
    Ok(bytes)
}

/// A line from the desk as its message; `None` when it is not one.
pub fn compositor_message(line: &str) -> Option<CompositorMessage> {
    serde_json::from_str(line).ok()
}

/// A line from a plugin as its message; `None` when it is not one.
pub fn surface_message(line: &str) -> Option<SurfaceMessage> {
    serde_json::from_str(line).ok()
}

#[cfg(test)]
mod tests {
    use super::{LineReader, MOST_LINE, Next, compositor_message, line, surface_message};
    use crate::SurfaceMessage;
    use serde_json::json;

    #[test]
    fn lines_come_whole_in_order_and_too_long_or_wrong_ones_are_refused() {
        let ready: SurfaceMessage =
            serde_json::from_value(json!({ "type": "ready", "surface": "main.a-b" })).unwrap();
        let mut bytes = line(&ready).unwrap();
        bytes.extend_from_slice(b"{\"type\":\"show\",\"surface\":\"main.a-b\"}\n");
        let mut reader = LineReader::new(&bytes[..]);
        let Next::Line(first) = reader.next_line().unwrap() else {
            panic!()
        };
        assert!(matches!(
            surface_message(&first),
            Some(SurfaceMessage::SurfaceReady(_))
        ));
        assert!(
            compositor_message(&first).is_none(),
            "ready is not the desk's"
        );
        let Next::Line(second) = reader.next_line().unwrap() else {
            panic!()
        };
        assert!(compositor_message(&second).is_some());
        assert!(matches!(reader.next_line().unwrap(), Next::Closed));
        let long = vec![b'x'; MOST_LINE + 1];
        assert!(LineReader::new(&long[..]).next_line().is_err());
    }
}
