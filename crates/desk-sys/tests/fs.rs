//! desk-sys fs primitives (feature `fs`): read bytes, list a folder, write atomically and watch.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use desk_sys::fs::{
    Change, Changed, EntryKind, WatchOptions, list, read, watch_changes, watch_debounced, write,
};
use desk_sys::{Error, ErrorCode};

/// The bridge code an fs error maps to.
fn code(err: std::io::Error) -> ErrorCode {
    Error::from(err).code
}

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

fn names(dir: &Path) -> Vec<String> {
    list(dir).unwrap().into_iter().map(|e| e.name).collect()
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
fn write_creates_a_file_and_reports_the_bytes_written() {
    let dir = temp_dir();
    let written = write(&dir.join("new.txt"), b"fresh", false).unwrap();
    assert_eq!(written, 5);
    assert_eq!(fs::read(dir.join("new.txt")).unwrap(), b"fresh");
}

#[test]
fn write_replaces_a_file_atomically_and_leaves_no_temp_files() {
    let dir = temp_dir();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir.join("b.txt"), fs::Permissions::from_mode(0o640)).unwrap();
    }
    let written = write(&dir.join("b.txt"), b"replaced", false).unwrap();
    assert_eq!(written, 8);
    assert_eq!(fs::read(dir.join("b.txt")).unwrap(), b"replaced");
    assert_eq!(names(&dir), ["a.bin", "b.txt", "sub"]);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(dir.join("b.txt"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(
            mode & 0o777,
            0o640,
            "an existing file keeps its permissions"
        );
    }
}

#[test]
fn write_reports_a_missing_folder_as_not_found_unless_create_dirs() {
    let dir = temp_dir();
    let target = dir.join("x").join("y").join("z.txt");
    let err = write(&target, b"deep", false).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::NotFound, "{err}");
    assert_eq!(code(err), ErrorCode::NotFound);
    assert!(!dir.join("x").exists());

    assert_eq!(write(&target, b"deep", true).unwrap(), 4);
    assert_eq!(fs::read(&target).unwrap(), b"deep");
}

#[test]
fn write_refuses_a_folder_and_a_symlink() {
    let dir = temp_dir();
    let err = write(&dir.join("sub"), b"no", false).unwrap_err();
    assert_eq!(code(err), ErrorCode::InvalidParams);
    assert!(dir.join("sub").is_dir());

    #[cfg(unix)]
    {
        let link = dir.join("link.txt");
        std::os::unix::fs::symlink(dir.join("b.txt"), &link).unwrap();
        let err = write(&link, b"through", false).unwrap_err();
        assert_eq!(code(err), ErrorCode::InvalidParams);
        assert!(
            fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(fs::read(dir.join("b.txt")).unwrap(), b"hello");
    }
    assert_eq!(
        names(&dir)
            .into_iter()
            .filter(|n| n != "link.txt")
            .collect::<Vec<_>>(),
        ["a.bin", "b.txt", "sub"],
        "a refused write leaves no temp file"
    );
}

/// Start a debounced watch whose batches arrive on the returned channel.
fn start_watch(dir: &Path, recursive: bool) -> (desk_sys::fs::Watch, Receiver<Vec<Changed>>) {
    let (sender, receiver) = mpsc::channel();
    let options = WatchOptions {
        recursive,
        ..WatchOptions::default()
    };
    let watch = watch_debounced(dir, options, move |batch| {
        let _ = sender.send(batch);
    })
    .unwrap();
    // FSEvents and ReadDirectoryChangesW start a moment after the call returns.
    std::thread::sleep(Duration::from_millis(200));
    (watch, receiver)
}

/// Collect batches until one holds `path`, and return that batch.
fn batch_with(receiver: &Receiver<Vec<Changed>>, path: &Path) -> Vec<Changed> {
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut seen = Vec::new();
    while Instant::now() < deadline {
        match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(batch) if batch.iter().any(|c| c.path == path) => return batch,
            Ok(batch) => seen.push(batch),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    panic!("no batch with {} in 10 s; saw {seen:?}", path.display());
}

/// Every batch that arrives until the watch has been quiet for `quiet`.
fn batches_until_quiet(receiver: &Receiver<Vec<Changed>>, quiet: Duration) -> Vec<Vec<Changed>> {
    let mut batches = Vec::new();
    while let Ok(batch) = receiver.recv_timeout(quiet) {
        batches.push(batch);
    }
    batches
}

fn change_of(batch: &[Changed], path: &Path) -> Change {
    batch.iter().find(|c| c.path == path).unwrap().change
}

#[test]
fn watch_reports_created_modified_and_removed_paths() {
    let dir = temp_dir();
    let (_watch, receiver) = start_watch(&dir, true);

    let created = dir.join("c.txt");
    fs::write(&created, "new").unwrap();
    assert_eq!(
        change_of(&batch_with(&receiver, &created), &created),
        Change::Created
    );
    batches_until_quiet(&receiver, Duration::from_millis(300));

    let modified = dir.join("b.txt");
    fs::write(&modified, "changed").unwrap();
    let change = change_of(&batch_with(&receiver, &modified), &modified);
    // FSEvents can repeat a recent creation flag on a later write, so macOS may say created.
    if cfg!(target_os = "macos") {
        assert_ne!(change, Change::Removed);
    } else {
        assert_eq!(change, Change::Modified);
    }
    batches_until_quiet(&receiver, Duration::from_millis(300));

    let nested = dir.join("sub").join("deep.txt");
    fs::write(&nested, "deep").unwrap();
    assert_eq!(
        change_of(&batch_with(&receiver, &nested), &nested),
        Change::Created
    );
    batches_until_quiet(&receiver, Duration::from_millis(300));

    fs::remove_file(&created).unwrap();
    assert_eq!(
        change_of(&batch_with(&receiver, &created), &created),
        Change::Removed
    );
}

#[test]
fn watch_coalesces_a_burst_into_one_batch() {
    let dir = temp_dir();
    let (_watch, receiver) = start_watch(&dir, true);
    let path = dir.join("burst.txt");
    for i in 0..20 {
        fs::write(&path, format!("write {i}")).unwrap();
    }
    let first = batch_with(&receiver, &path);
    let mut batches = vec![first];
    batches.extend(batches_until_quiet(&receiver, Duration::from_millis(500)));
    let entries = batches.iter().flatten().filter(|c| c.path == path).count();
    assert_eq!(entries, 1, "twenty writes arrive as one entry: {batches:?}");
}

#[test]
fn watch_without_recursive_ignores_sub_folders() {
    let dir = temp_dir();
    let (_watch, receiver) = start_watch(&dir, false);
    let nested = dir.join("sub").join("x.txt");
    let top = dir.join("y.txt");
    fs::write(&nested, "nested").unwrap();
    fs::write(&top, "top").unwrap();
    let mut batches = vec![batch_with(&receiver, &top)];
    batches.extend(batches_until_quiet(&receiver, Duration::from_millis(500)));
    assert!(
        batches.iter().flatten().all(|c| c.path != nested),
        "a sub-folder change was reported: {batches:?}"
    );
}

#[test]
fn dropping_the_watch_stops_events() {
    let dir = temp_dir();
    let (watch, receiver) = start_watch(&dir, true);
    let path = dir.join("c.txt");
    fs::write(&path, "one").unwrap();
    batch_with(&receiver, &path);

    drop(watch);
    fs::write(dir.join("after.txt"), "two").unwrap();
    // The callback (and the sender it holds) is gone once drop returns, so nothing more can arrive.
    assert_eq!(
        receiver
            .recv_timeout(Duration::from_millis(500))
            .map(|_| ()),
        Err(RecvTimeoutError::Disconnected)
    );
}

#[test]
fn watch_reports_a_missing_path_as_not_found() {
    let dir = temp_dir();
    let err = watch_debounced(&dir.join("missing"), WatchOptions::default(), |_| {})
        .err()
        .expect("watching a missing path fails");
    assert_eq!(code(err), ErrorCode::NotFound);
    let err = watch_changes(&dir.join("missing"), true, |_, _| {})
        .err()
        .expect("watching a missing path fails");
    assert_eq!(code(err), ErrorCode::NotFound);
}

#[test]
fn watch_changes_reports_each_event_with_its_kind() {
    let dir = temp_dir();
    let (sender, receiver) = mpsc::channel();
    let _watch = watch_changes(&dir, false, move |path, change| {
        let _ = sender.send((path, change));
    })
    .unwrap();
    std::thread::sleep(Duration::from_millis(200));
    fs::write(dir.join("c.txt"), "new").unwrap();
    fs::remove_file(dir.join("a.bin")).unwrap();
    let real = dir.canonicalize().unwrap();
    let (mut created, mut removed) = (false, false);
    let deadline = Instant::now() + Duration::from_secs(10);
    while !(created && removed) && Instant::now() < deadline {
        if let Ok((path, change)) = receiver.recv_timeout(Duration::from_millis(100)) {
            created |= path == real.join("c.txt") && change == Change::Created;
            removed |= path == real.join("a.bin") && change == Change::Removed;
        }
    }
    assert!(created && removed, "created: {created}, removed: {removed}");
}
