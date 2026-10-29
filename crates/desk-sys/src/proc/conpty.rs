//! Windows ConPTY's startup handshake. portable-pty opens the console with
//! `PSEUDOCONSOLE_INHERIT_CURSOR`, so before the program runs, ConPTY asks for the cursor position
//! (`ESC [ 6 n`) and waits for the answer. A terminal would answer it; the caller of `spawn` may not
//! be one, so the PTY answers that first query itself (top-left corner) and keeps it out of the
//! output. Later queries come from the program and pass through untouched.

use std::io::{self, Read, Write};
use std::sync::{Arc, Mutex};

/// Device Status Report: where is the cursor?
const QUERY: &[u8] = b"\x1b[6n";
/// Cursor Position Report: row 1, column 1.
const ANSWER: &[u8] = b"\x1b[1;1R";

/// The PTY output, with ConPTY's first cursor query answered on `input` and removed.
pub(super) struct Handshake<R, W> {
    output: R,
    /// Where the answer goes; None once the query is answered or the output has ended.
    input: Option<Arc<Mutex<W>>>,
    /// Output read but not yet returned.
    pending: Vec<u8>,
}

impl<R: Read, W: Write> Handshake<R, W> {
    pub(super) fn new(output: R, input: Arc<Mutex<W>>) -> Self {
        Self {
            output,
            input: Some(input),
            pending: Vec::new(),
        }
    }

    fn answer(&mut self) {
        if let Some(input) = self.input.take() {
            let mut input = input.lock().unwrap_or_else(|e| e.into_inner());
            // A console that is already gone has nothing left to wait for.
            let _ = input.write_all(ANSWER).and_then(|()| input.flush());
        }
    }
}

impl<R: Read, W: Write> Read for Handshake<R, W> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let ready = loop {
            if self.input.is_none() {
                break self.pending.len();
            }
            // Bytes that may start the query wait for the next read to complete or rule it out.
            let ready = self.pending.len() - partial_query_at_end(&self.pending);
            if ready > 0 {
                break ready;
            }
            let mut chunk = [0; 4096];
            let n = self.output.read(&mut chunk)?;
            if n == 0 {
                self.input = None;
                continue;
            }
            self.pending.extend_from_slice(&chunk[..n]);
            if let Some(at) = self.pending.windows(QUERY.len()).position(|w| w == QUERY) {
                self.pending.drain(at..at + QUERY.len());
                self.answer();
            }
        };
        if ready == 0 {
            return self.output.read(buf);
        }
        let n = ready.min(buf.len());
        buf[..n].copy_from_slice(&self.pending[..n]);
        self.pending.drain(..n);
        Ok(n)
    }
}

/// How many bytes at the end of `bytes` are the start of `QUERY`.
fn partial_query_at_end(bytes: &[u8]) -> usize {
    (1..QUERY.len())
        .rev()
        .find(|&len| bytes.ends_with(&QUERY[..len]))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Output that arrives in the given chunks, one per read.
    struct Chunks(Vec<&'static [u8]>);

    impl Read for Chunks {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            if self.0.is_empty() {
                return Ok(0);
            }
            let chunk = self.0.remove(0);
            buf[..chunk.len()].copy_from_slice(chunk);
            Ok(chunk.len())
        }
    }

    fn run(chunks: Vec<&'static [u8]>) -> (Vec<u8>, Vec<u8>) {
        let input = Arc::new(Mutex::new(Vec::new()));
        let mut output = Vec::new();
        Handshake::new(Chunks(chunks), Arc::clone(&input))
            .read_to_end(&mut output)
            .unwrap();
        let answered = input.lock().unwrap().clone();
        (output, answered)
    }

    #[test]
    fn answers_the_first_query_and_removes_it() {
        let (output, answered) = run(vec![b"\x1b[6n", b"ready"]);
        assert_eq!(output, b"ready");
        assert_eq!(answered, ANSWER);
    }

    #[test]
    fn finds_the_query_among_other_output_and_across_reads() {
        let (output, answered) = run(vec![b"\x1b[?9001h\x1b", b"[6", b"nready"]);
        assert_eq!(output, b"\x1b[?9001hready");
        assert_eq!(answered, ANSWER);
    }

    #[test]
    fn later_queries_pass_through() {
        let (output, answered) = run(vec![b"\x1b[6n", b"a\x1b[6nb"]);
        assert_eq!(output, b"a\x1b[6nb");
        assert_eq!(answered, ANSWER);
    }

    #[test]
    fn output_without_a_query_is_kept_whole() {
        let (output, answered) = run(vec![b"abc\x1b[", b"1mdef\x1b["]);
        assert_eq!(output, b"abc\x1b[1mdef\x1b[");
        assert!(answered.is_empty());
    }
}
