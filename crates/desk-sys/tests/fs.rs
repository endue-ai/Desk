//! desk-sys fs primitives (feature `fs`): read bytes and list a folder.

use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use desk_sys::fs::{EntryKind, list, read};

fn temp_dir() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("desk-sys-{}-{nanos}", std::process::id()));
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

#[test]
fn write_creates_and_overwrites() {
    let dir = temp_dir();
    let file = dir.join("new.txt");
    assert_eq!(desk_sys::fs::write(&file, b"one").unwrap(), 3);
    assert_eq!(desk_sys::fs::write(&file, b"two!").unwrap(), 4);
    assert_eq!(read(&file).unwrap(), b"two!");
    let missing = desk_sys::fs::write(&dir.join("no/such/dir.txt"), b"x").unwrap_err();
    assert_eq!(missing.kind(), ErrorKind::NotFound);
}

#[test]
fn watch_changes_reports_created_modified_and_removed() {
    use desk_sys::fs::{ChangeKind, watch_changes};
    use std::sync::mpsc;
    use std::time::Duration;

    let dir = temp_dir();
    let (sender, receiver) = mpsc::channel();
    let _watch = watch_changes(&dir, false, move |change| {
        let _ = sender.send(change);
    })
    .unwrap();
    let file = dir.join("watched.txt");
    let seen = |kind: ChangeKind| {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            if let Ok(change) = receiver.recv_timeout(Duration::from_millis(100))
                && change.kind == kind
                && change.path.file_name() == file.file_name()
            {
                return true;
            }
        }
        false
    };
    fs::write(&file, "a").unwrap();
    assert!(seen(ChangeKind::Created), "created");
    fs::write(&file, "ab").unwrap();
    assert!(seen(ChangeKind::Modified), "modified");
    fs::remove_file(&file).unwrap();
    assert!(seen(ChangeKind::Removed), "removed");
}
