//! The `text/event-stream` format, read as WHATWG's EventSource reads it: CR, LF and CRLF line ends,
//! a leading BOM, comments, and the `event`, `data`, `id` and `retry` fields.

use std::mem;
use std::time::Duration;

use super::{Event, Message};
use crate::net::MAX_BODY_BYTES;

const BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];

/// Bytes in, events out; a line or an event may span any number of reads.
pub(super) struct Parser {
    /// The first bytes, until they are known to be a BOM or not.
    head: Option<Vec<u8>>,
    line: Vec<u8>,
    /// The last byte ended a line with CR: a LF right after it belongs to the same line end.
    after_cr: bool,
    event: String,
    data: String,
    last_id: String,
}

impl Parser {
    /// A stream that continues from `last_id`: events without an `id` field carry it.
    pub(super) fn new(last_id: &str) -> Self {
        Self {
            head: Some(Vec::new()),
            line: Vec::new(),
            after_cr: false,
            event: String::new(),
            data: String::new(),
            last_id: last_id.to_owned(),
        }
    }

    /// Read `bytes`, sending each complete event to `emit`. An event larger than `MAX_BODY_BYTES`
    /// is an error.
    pub(super) fn feed(
        &mut self,
        bytes: &[u8],
        emit: &mut impl FnMut(Event),
    ) -> Result<(), String> {
        for &byte in bytes {
            let Some(head) = &mut self.head else {
                self.byte(byte, emit)?;
                continue;
            };
            head.push(byte);
            if BOM.starts_with(head) {
                if head.len() == BOM.len() {
                    self.head = None;
                }
                continue;
            }
            let replay = mem::take(head);
            self.head = None;
            for byte in replay {
                self.byte(byte, emit)?;
            }
        }
        Ok(())
    }

    fn byte(&mut self, byte: u8, emit: &mut impl FnMut(Event)) -> Result<(), String> {
        let after_cr = mem::replace(&mut self.after_cr, false);
        match byte {
            b'\n' if after_cr => {}
            b'\n' => self.line_end(emit),
            b'\r' => {
                self.after_cr = true;
                self.line_end(emit);
            }
            _ => {
                self.line.push(byte);
                if (self.line.len() + self.data.len()) as u64 > MAX_BODY_BYTES {
                    return Err(format!("an event larger than {MAX_BODY_BYTES} bytes"));
                }
            }
        }
        Ok(())
    }

    fn line_end(&mut self, emit: &mut impl FnMut(Event)) {
        let line = mem::take(&mut self.line);
        let line = String::from_utf8_lossy(&line);
        if line.is_empty() {
            return self.dispatch(emit);
        }
        if line.starts_with(':') {
            return;
        }
        let (field, value) = match line.split_once(':') {
            Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
            None => (&*line, ""),
        };
        match field {
            "event" => self.event = value.to_owned(),
            "data" => {
                self.data.push_str(value);
                self.data.push('\n');
            }
            "id" if !value.contains('\0') => self.last_id = value.to_owned(),
            "retry" if !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit()) => {
                if let Ok(millis) = value.parse::<u64>() {
                    emit(Event::Retry(Duration::from_millis(millis)));
                }
            }
            _ => {}
        }
    }

    /// A blank line: the buffered event goes out, unless it has no data.
    fn dispatch(&mut self, emit: &mut impl FnMut(Event)) {
        let event = mem::take(&mut self.event);
        let mut data = mem::take(&mut self.data);
        if data.is_empty() {
            return;
        }
        data.pop();
        emit(Event::Message(Message {
            event: if event.is_empty() {
                "message".to_owned()
            } else {
                event
            },
            data,
            id: self.last_id.clone(),
        }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn events(chunks: &[&[u8]]) -> Vec<Event> {
        let mut parser = Parser::new("");
        let mut out = Vec::new();
        for chunk in chunks {
            parser.feed(chunk, &mut |event| out.push(event)).unwrap();
        }
        out
    }

    fn data(text: &str) -> Event {
        Event::Message(Message {
            event: "message".to_owned(),
            data: text.to_owned(),
            id: String::new(),
        })
    }

    #[test]
    fn a_bom_split_across_reads_and_a_crlf_split_at_the_cr() {
        assert_eq!(
            events(&[b"\xEF\xBB", b"\xBFdata: a\r", b"\n\r\n"]),
            [data("a")]
        );
        // Not a BOM: the bytes are kept.
        assert_eq!(events(&[b"\xEFdata: b\n\n"]), []);
        assert_eq!(events(&[b"da", b"ta:c\n", b"\n"]), [data("c")]);
    }

    #[test]
    fn unknown_fields_and_bad_retries_are_ignored() {
        assert_eq!(events(&[b"foo: bar\nretry: 1x\ndata\n\n"]), [data("")]);
    }
}
