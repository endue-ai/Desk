//! The files fs.url hands out, served on `desk-plugin` with HTTP ranges (ADR 0041): which part of
//! the file a request asks for, and a response with only that part read from disk. One range per
//! request; several, or one this server does not understand, get the whole file (RFC 9110 lets a
//! server ignore Range). Tauri's response bodies live in memory, so no response carries more than
//! `MAX_PART` of a range; media elements ask again from where it ended.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};

use desk_core::FileUrl;
use tauri::http::{Response, StatusCode, header};

/// The longest part one response carries.
pub const MAX_PART: u64 = 2 * 1024 * 1024;

/// The largest file answered whole without a range; a larger one gets its first part, as for
/// `bytes=0-`, so a frame that asks for a film without a range cannot fill memory.
pub const MAX_WHOLE: u64 = 64 * 1024 * 1024;

/// A file URL is a document of nothing: never a page that could run without the plugin's CSP.
const FILE_CSP: &str = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/// What to send for a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Part {
    /// 200 with the whole file.
    Whole,
    /// 206 with the bytes from `start` to `end`, both included.
    Range { start: u64, end: u64 },
    /// 416: the range starts at or past the end.
    Unsatisfiable,
}

/// The part of a `size`-byte file to send for a `Range` header (or none).
pub fn plan(range: Option<&str>, size: u64) -> Part {
    let part = |start: u64, end: u64| Part::Range {
        start,
        end: end.min(size - 1).min(start.saturating_add(MAX_PART - 1)),
    };
    match range.and_then(parse) {
        None if size > MAX_WHOLE => part(0, u64::MAX),
        None => Part::Whole,
        Some(Asked::From(start, _)) if start >= size => Part::Unsatisfiable,
        Some(Asked::From(start, end)) => part(start, end.unwrap_or(u64::MAX)),
        Some(Asked::Suffix(length)) if length == 0 || size == 0 => Part::Unsatisfiable,
        Some(Asked::Suffix(length)) => part(size - length.min(size), u64::MAX),
    }
}

/// One byte range as asked.
#[derive(Debug, PartialEq, Eq)]
enum Asked {
    /// `bytes=start-` or `bytes=start-end`.
    From(u64, Option<u64>),
    /// `bytes=-length`: the last `length` bytes.
    Suffix(u64),
}

/// A `Range` header with one valid byte range; `None` for anything else.
fn parse(header: &str) -> Option<Asked> {
    let (unit, ranges) = header.trim().split_once('=')?;
    if !unit.trim().eq_ignore_ascii_case("bytes") || ranges.contains(',') {
        return None;
    }
    let (first, last) = ranges.trim().split_once('-')?;
    let number = |text: &str| -> Option<u64> {
        let text = text.trim();
        (!text.is_empty() && text.bytes().all(|b| b.is_ascii_digit()))
            .then(|| text.parse().ok())
            .flatten()
    };
    if first.trim().is_empty() {
        return number(last).map(Asked::Suffix);
    }
    let start = number(first)?;
    if last.trim().is_empty() {
        return Some(Asked::From(start, None));
    }
    let end = number(last)?;
    (end >= start).then_some(Asked::From(start, Some(end)))
}

/// The response for a file URL: `file` is what the core resolved the token to (`None`: unknown or
/// ended), `range` the request's `Range` header, `head` whether it was a HEAD request.
pub fn respond(file: Option<FileUrl>, range: Option<&str>, head: bool) -> Response<Vec<u8>> {
    let Some(file) = file else {
        return status(StatusCode::NOT_FOUND);
    };
    match read(&file, range, head) {
        Ok(response) => response,
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
            status(StatusCode::FORBIDDEN)
        }
        Err(_) => status(StatusCode::NOT_FOUND),
    }
}

fn read(file: &FileUrl, range: Option<&str>, head: bool) -> io::Result<Response<Vec<u8>>> {
    if std::fs::metadata(&file.path)?.is_dir() {
        return Err(io::Error::from(io::ErrorKind::IsADirectory));
    }
    let mut opened = File::open(&file.path)?;
    let size = opened.metadata()?.len();
    let response = Response::builder()
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_TYPE, file.media_type)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CONTENT_SECURITY_POLICY, FILE_CSP);
    // A HEAD request learns the size; Range applies to GET only.
    let part = if head { Part::Whole } else { plan(range, size) };
    let (start, end) = match part {
        Part::Unsatisfiable => {
            return Ok(response
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{size}"))
                .body(Vec::new())
                .unwrap_or_default());
        }
        Part::Whole if head => {
            return Ok(response
                .header(header::CONTENT_LENGTH, size)
                .body(Vec::new())
                .unwrap_or_default());
        }
        Part::Whole => (0, None),
        Part::Range { start, end } => (start, Some(end)),
    };
    opened.seek(SeekFrom::Start(start))?;
    let mut bytes = Vec::new();
    match end {
        Some(end) => {
            let length = end - start + 1;
            bytes.reserve_exact(usize::try_from(length).unwrap_or(0));
            opened.take(length).read_to_end(&mut bytes)?;
        }
        None => {
            opened.read_to_end(&mut bytes)?;
        }
    }
    let length = bytes.len() as u64;
    let response = response.header(header::CONTENT_LENGTH, length);
    let response = match end {
        None => response.status(StatusCode::OK),
        // The file shrank since its size was read: nothing is left of the range.
        Some(_) if length == 0 => {
            return Ok(status(StatusCode::RANGE_NOT_SATISFIABLE));
        }
        Some(_) => response.status(StatusCode::PARTIAL_CONTENT).header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{}/{size}", start + length - 1),
        ),
    };
    Ok(response.body(bytes).unwrap_or_default())
}

fn status(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Vec::new())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const GB: u64 = 1 << 30;

    #[test]
    fn one_range_is_parsed_and_clamped_to_the_file() {
        assert_eq!(
            plan(Some("bytes=10-19"), 100),
            Part::Range { start: 10, end: 19 }
        );
        assert_eq!(
            plan(Some("Bytes = 10 - 19"), 100),
            Part::Range { start: 10, end: 19 }
        );
        assert_eq!(
            plan(Some("bytes=90-"), 100),
            Part::Range { start: 90, end: 99 }
        );
        assert_eq!(
            plan(Some("bytes=-5"), 100),
            Part::Range { start: 95, end: 99 }
        );
        assert_eq!(
            plan(Some("bytes=-500"), 100),
            Part::Range { start: 0, end: 99 }
        );
        assert_eq!(
            plan(Some("bytes=99-99"), 100),
            Part::Range { start: 99, end: 99 }
        );
    }

    #[test]
    fn a_long_range_is_answered_one_part_at_a_time() {
        let first = Part::Range {
            start: 0,
            end: MAX_PART - 1,
        };
        assert_eq!(plan(Some("bytes=0-"), 3 * GB), first);
        assert_eq!(
            plan(Some(&format!("bytes=0-{}", 3 * GB - 1)), 3 * GB),
            first
        );
        let middle = 3 * GB / 2;
        assert_eq!(
            plan(Some(&format!("bytes={middle}-")), 3 * GB),
            Part::Range {
                start: middle,
                end: middle + MAX_PART - 1
            }
        );
        assert_eq!(
            plan(Some(&format!("bytes=-{}", 2 * MAX_PART)), 3 * GB),
            Part::Range {
                start: 3 * GB - 2 * MAX_PART,
                end: 3 * GB - MAX_PART - 1
            }
        );
    }

    #[test]
    fn outside_the_file_is_unsatisfiable() {
        assert_eq!(plan(Some("bytes=100-"), 100), Part::Unsatisfiable);
        assert_eq!(plan(Some("bytes=100-200"), 100), Part::Unsatisfiable);
        assert_eq!(plan(Some("bytes=-0"), 100), Part::Unsatisfiable);
        assert_eq!(plan(Some("bytes=0-"), 0), Part::Unsatisfiable);
        assert_eq!(plan(Some("bytes=-1"), 0), Part::Unsatisfiable);
        let huge = format!("bytes={}-", u64::MAX);
        assert_eq!(plan(Some(&huge), 100), Part::Unsatisfiable);
    }

    #[test]
    fn anything_else_is_the_whole_file_or_for_a_film_its_first_part() {
        for range in [
            None,
            Some("bytes=0-1,5-9"),
            Some("items=0-5"),
            Some("bytes=9-2"),
            Some("bytes=a-b"),
            Some("bytes=+1-2"),
            Some("bytes=-"),
            Some("bytes=99999999999999999999999-"),
            Some(""),
        ] {
            assert_eq!(plan(range, 100), Part::Whole, "{range:?}");
            assert_eq!(
                plan(range, 3 * GB),
                Part::Range {
                    start: 0,
                    end: MAX_PART - 1
                },
                "{range:?}"
            );
        }
        assert_eq!(plan(None, MAX_WHOLE), Part::Whole);
        assert_eq!(plan(None, 0), Part::Whole);
    }
}
