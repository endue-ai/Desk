//! desk-sys trash (feature `fs`): `trash` moves a path to the OS trash and never deletes it.
//!
//! On Linux and the BSDs the trash runs in a child process, the test binary again (the `child` test
//! acts only when `DESK_SYS_TEST_CHILD` names a role), with `XDG_DATA_HOME` pointing at a temp
//! folder, so the test never touches the trash of whoever runs it.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use desk_sys::fs::trash;
use desk_sys::{Error, ErrorCode};

/// Keeps the folders of tests that read the same nanosecond apart.
static NEXT: AtomicU32 = AtomicU32::new(0);

fn temp_dir() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    let dir =
        std::env::temp_dir().join(format!("desk-sys-trash-{}-{nanos}-{n}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn trash_reports_a_missing_path_as_not_found() {
    let dir = temp_dir();
    let err = trash(&dir.join("missing")).unwrap_err();
    assert_eq!(Error::from(err).code, ErrorCode::NotFound);
    assert!(fs::read_dir(&dir).unwrap().next().is_none());
}

#[cfg(any(target_os = "macos", windows))]
#[test]
#[ignore = "moves a file to the real Trash or Recycle Bin of whoever runs it"]
fn trash_moves_a_file_to_the_os_trash() {
    let dir = temp_dir();
    let file = dir.join("desk-sys trash test.txt");
    fs::write(&file, "trash me").unwrap();
    trash(&file).unwrap();
    assert!(fs::symlink_metadata(&file).is_err(), "the file is gone");
    assert!(fs::read_dir(&dir).unwrap().next().is_none());
}

#[cfg(all(
    unix,
    not(target_os = "macos"),
    not(target_os = "ios"),
    not(target_os = "android")
))]
mod freedesktop {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    use desk_sys::fs::trash;

    const ROLE: &str = "DESK_SYS_TEST_CHILD";
    /// The folder whose `file.txt`, `folder` and `link` the child moves to the trash.
    const DIR: &str = "DESK_SYS_TEST_DIR";

    /// The child program: trash the three entries, and fail (exit 101) if any call fails.
    #[test]
    fn child() {
        let Ok(role) = std::env::var(ROLE) else {
            return;
        };
        assert_eq!(role, "trash", "unknown role");
        let dir = PathBuf::from(std::env::var_os(DIR).unwrap());
        for name in ["file.txt", "folder", "link"] {
            trash(&dir.join(name)).unwrap();
        }
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn trash_moves_files_folders_and_links_to_the_freedesktop_trash() {
        let root = super::temp_dir();
        let data_home = root.join("data");
        let files = root.join("files");
        fs::create_dir_all(&data_home).unwrap();
        fs::create_dir_all(files.join("folder")).unwrap();
        fs::write(files.join("file.txt"), "file").unwrap();
        fs::write(files.join("folder").join("inner.txt"), "inner").unwrap();
        fs::write(files.join("target.txt"), "target").unwrap();
        std::os::unix::fs::symlink(files.join("target.txt"), files.join("link")).unwrap();

        let output = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "freedesktop::child",
                "--nocapture",
                "--test-threads=1",
            ])
            .env(ROLE, "trash")
            .env(DIR, &files)
            .env("XDG_DATA_HOME", &data_home)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "the child failed: {}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );

        assert_eq!(names(&files), ["target.txt"], "the three are gone");
        assert_eq!(fs::read(files.join("target.txt")).unwrap(), b"target");

        let trashed = data_home.join("Trash").join("files");
        assert_eq!(names(&trashed), ["file.txt", "folder", "link"]);
        assert_eq!(fs::read(trashed.join("file.txt")).unwrap(), b"file");
        assert_eq!(
            fs::read(trashed.join("folder").join("inner.txt")).unwrap(),
            b"inner"
        );
        let link = fs::symlink_metadata(trashed.join("link")).unwrap();
        assert!(link.file_type().is_symlink(), "the link itself is trashed");
        assert_eq!(
            fs::read_link(trashed.join("link")).unwrap(),
            files.join("target.txt")
        );
        assert_eq!(
            names(&data_home.join("Trash").join("info")),
            ["file.txt.trashinfo", "folder.trashinfo", "link.trashinfo"]
        );
    }
}
