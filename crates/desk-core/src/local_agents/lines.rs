//! Reading the programs' JSON-lines files: a bounded head and tail for listing (large sessions are
//! listed without reading them whole), every line for a transcript, and `.zst` files (Codex
//! compresses older sessions) through a streaming zstd decoder that stops once enough is read.

use std::fs::File;
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

use serde_json::Value;

/// How much of each end of a file listing reads.
pub(crate) const EDGE: u64 = 64 * 1024;
/// The longest line a transcript reads; longer ones (attachments, request blobs) are skipped.
const LINE_MAX: usize = 4 * 1024 * 1024;

/// Whether `path` is zstd-compressed, by its name.
pub(crate) fn compressed(path: &Path) -> bool {
    path.extension().is_some_and(|e| e == "zst")
}

/// A reader of the file's text: decompressed when it is a `.zst` file.
pub(crate) fn open(path: &Path) -> io::Result<Box<dyn Read>> {
    let file = File::open(path)?;
    if compressed(path) {
        let decoder = ruzstd::decoding::StreamingDecoder::new(BufReader::new(file))
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;
        Ok(Box::new(decoder))
    } else {
        Ok(Box::new(file))
    }
}

/// The JSON objects among the first `limit` bytes of text (the last line only when it is whole).
pub(crate) fn head(path: &Path, limit: u64) -> io::Result<Vec<Value>> {
    let mut all = Vec::new();
    head_each(path, limit, |v| {
        all.push(v);
        true
    })?;
    Ok(all)
}

/// The JSON objects among the first `limit` bytes, in order, to `each` until it answers false. The
/// file is read (and decoded) only as far as that: a line the limit cuts does not parse.
pub(crate) fn head_each(
    path: &Path,
    limit: u64,
    mut each: impl FnMut(Value) -> bool,
) -> io::Result<()> {
    let mut reader = BufReader::with_capacity(32 * 1024, open(path)?.take(limit));
    let mut line = Vec::new();
    loop {
        line.clear();
        if read_line(&mut reader, &mut line)? == 0 {
            return Ok(());
        }
        if let Ok(value) = serde_json::from_slice::<Value>(&line)
            && value.is_object()
            && !each(value)
        {
            return Ok(());
        }
    }
}

/// The JSON objects among the last `EDGE` bytes of a plain file of `size` bytes after the first
/// `head` bytes, none when the head already read it whole or it is compressed.
pub(crate) fn tail(path: &Path, size: u64, head: u64) -> io::Result<Vec<Value>> {
    if compressed(path) || size <= head {
        return Ok(Vec::new());
    }
    let mut file = File::open(path)?;
    let from = size.saturating_sub(EDGE).max(head);
    file.seek(SeekFrom::Start(from))?;
    let mut bytes = Vec::new();
    file.take(EDGE).read_to_end(&mut bytes)?;
    Ok(objects(&bytes, true, true))
}

/// The objects of whole lines in `bytes`: the first line is skipped when it may be cut at its
/// start (`cut_start`), the last when it may be cut at its end (`!whole_end`).
fn objects(bytes: &[u8], whole_end: bool, cut_start: bool) -> Vec<Value> {
    let mut lines: Vec<&[u8]> = bytes.split(|b| *b == b'\n').collect();
    if cut_start && !lines.is_empty() {
        lines.remove(0);
    }
    if !whole_end {
        lines.pop();
    }
    lines
        .into_iter()
        .filter_map(|line| serde_json::from_slice::<Value>(line).ok())
        .filter(Value::is_object)
        .collect()
}

/// Every JSON object line of the file, in order, to `each`.
pub(crate) fn each(path: &Path, mut each: impl FnMut(&Value)) -> io::Result<()> {
    let mut reader = BufReader::with_capacity(256 * 1024, open(path)?);
    let mut line = Vec::new();
    loop {
        line.clear();
        if read_line(&mut reader, &mut line)? == 0 {
            return Ok(());
        }
        if line.len() > LINE_MAX {
            continue;
        }
        if let Ok(value) = serde_json::from_slice::<Value>(&line)
            && value.is_object()
        {
            each(&value);
        }
    }
}

/// One line into `line` (without its end), keeping at most `LINE_MAX + 1` bytes of it; the bytes
/// of the line read.
fn read_line(reader: &mut impl BufRead, line: &mut Vec<u8>) -> io::Result<usize> {
    let mut total = 0;
    loop {
        let buf = reader.fill_buf()?;
        if buf.is_empty() {
            return Ok(total);
        }
        let (part, done) = match buf.iter().position(|b| *b == b'\n') {
            Some(at) => (&buf[..at], Some(at + 1)),
            None => (buf, None),
        };
        if line.len() <= LINE_MAX {
            let room = LINE_MAX + 1 - line.len();
            line.extend_from_slice(&part[..part.len().min(room)]);
        }
        let used = done.unwrap_or(buf.len());
        total += used;
        reader.consume(used);
        if done.is_some() {
            return Ok(total);
        }
    }
}

/// A string field of `value` at `path` (`["payload", "id"]`), when it is a string.
pub(crate) fn text<'a>(value: &'a Value, path: &[&str]) -> Option<&'a str> {
    path.iter()
        .try_fold(value, |v, key| v.get(key))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edges_skip_lines_cut_in_the_middle() {
        let bytes = b"{\"a\":1}\n{\"b\":2}\n{\"c\"";
        assert_eq!(objects(bytes, false, false).len(), 2);
        assert_eq!(objects(bytes, false, true).len(), 1);
        assert_eq!(objects(b"{\"a\":1}\n[1]\nnope\n", true, false).len(), 1);
    }

    #[test]
    fn a_long_line_is_skipped_but_the_next_one_is_read() {
        let dir = std::env::temp_dir().join(format!("desk-lines-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("long.jsonl");
        let long = format!("{{\"x\":\"{}\"}}\n{{\"y\":1}}\n", "z".repeat(LINE_MAX + 10));
        std::fs::write(&path, long).unwrap();
        let mut seen = Vec::new();
        each(&path, |v| seen.push(v.clone())).unwrap();
        assert_eq!(seen, [serde_json::json!({ "y": 1 })]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
