//! desk-sys fs primitives (feature `fs`): read bytes and list a folder.

use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use desk_sys::fs::{EntryKind, list, read};

/// Tests run in parallel threads, and on macOS two of them can read the same nanosecond: the counter
/// keeps their folders apart, so one test never rewrites a file another is listing.
static NEXT: AtomicU32 = AtomicU32::new(0);

fn temp_dir() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("desk-sys-{}-{nanos}-{n}", std::process::id()));
    fs::create_dir_all(dir.join("sub")).unwrap();
    fs::write(dir.join("b.txt"), "hello").unwrap();
    fs::write(dir.join("a.bin"), [0u8, 1, 2]).unwrap();
    dir
}

#[test]
fn read_returns_the_bytes() {
    let dir = temp_dir();
    assert_eq!(read(&dir.join("b.txt")).unwrap(), b"hello");
    assert_eq!(read(&dir.join("a.bin")).unwrap(), vec![0u8, 1, 2]);
}

#[test]
fn read_reports_missing_files() {
    let dir = temp_dir();
    assert_eq!(
        read(&dir.join("missing")).unwrap_err().kind(),
        ErrorKind::NotFound
    );
}

#[test]
fn list_returns_entries_sorted_with_kind_and_size() {
    let dir = temp_dir();
    let entries = list(&dir).unwrap();
    let summary: Vec<(String, EntryKind, Option<u64>)> = entries
        .into_iter()
        .map(|e| (e.name, e.kind, e.size))
        .collect();
    assert_eq!(
        summary,
        vec![
            ("a.bin".to_owned(), EntryKind::File, Some(3)),
            ("b.txt".to_owned(), EntryKind::File, Some(5)),
            ("sub".to_owned(), EntryKind::Dir, None),
        ]
    );
}
