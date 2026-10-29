//! `Client`: the CLI's end of the socket. One request at a time; events that arrive while it waits for
//! an answer are kept for `next_event`.

use std::collections::VecDeque;
use std::io::{self, BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;

use desk_bridge::{BridgeEvent, BridgeRequest, BridgeResponse};

use crate::wire::{self, Incoming};

/// A connection to a running desk, as the caller `cli`.
pub struct Client {
    reader: BufReader<UnixStream>,
    writer: UnixStream,
    events: VecDeque<(BridgeEvent, String)>,
}

impl Client {
    /// Connect to the desk serving `path`. `NotFound` or `ConnectionRefused` mean no desk runs there.
    pub fn connect(path: &Path) -> io::Result<Self> {
        let stream = UnixStream::connect(path)?;
        Ok(Self {
            reader: BufReader::new(stream.try_clone()?),
            writer: stream,
            events: VecDeque::new(),
        })
    }

    /// Send `request` and wait for the answer with its id.
    pub fn call(&mut self, request: BridgeRequest) -> io::Result<BridgeResponse> {
        self.call_line(request).map(|(answer, _)| answer)
    }

    /// [`Client::call`], with the answer line as the desk sent it (without its `\n`).
    pub fn call_line(&mut self, request: BridgeRequest) -> io::Result<(BridgeResponse, String)> {
        let id = wire::request_id(&request);
        self.writer
            .write_all(wire::request_line(&request)?.as_bytes())?;
        loop {
            match self.receive()? {
                Incoming::Answer(answer, line) if wire::answer_id(&answer) == id => {
                    return Ok((answer, line));
                }
                Incoming::Event(event, line) => self.events.push_back((event, line)),
                Incoming::Answer(..) | Incoming::Skipped => {}
            }
        }
    }

    /// The next core event: a kept one first, then the next to arrive.
    pub fn next_event(&mut self) -> io::Result<BridgeEvent> {
        self.next_event_line().map(|(event, _)| event)
    }

    /// [`Client::next_event`], with the event line as the desk sent it (without its `\n`).
    pub fn next_event_line(&mut self) -> io::Result<(BridgeEvent, String)> {
        if let Some(kept) = self.events.pop_front() {
            return Ok(kept);
        }
        loop {
            if let Incoming::Event(event, line) = self.receive()? {
                return Ok((event, line));
            }
        }
    }

    fn receive(&mut self) -> io::Result<Incoming> {
        let mut line = String::new();
        if self.reader.read_line(&mut line)? == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "the desk closed the connection",
            ));
        }
        wire::incoming(line)
    }
}
