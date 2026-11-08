//! fs.trash on a core that was given no trash of its own: the OS trash. On Linux and the BSDs the
//! core runs in a child process, this test binary again (`child` acts only when `DESK_CORE_TEST_CHILD`
//! names a role), with `XDG_DATA_HOME` in a temp folder, so the test never touches the trash of
//! whoever runs it. On macOS and Windows that trash is the person's own, so the test is ignored.

use std::path::Path;

use desk_core::{Core, Roots};
use serde_json::json;

use crate::support::{FILES, call, grant, write};

/// Trash `~/work/a.txt` and `~/work/docs` as FILES on a core over `home` with the OS trash.
fn trash_both(home: &Path) {
    let core = Core::new(Roots {
        home: home.to_path_buf(),
    });
    grant(&core, FILES, write(&["~/work/**"]));
    for path in ["~/work/a.txt", "~/work/docs"] {
        let params = json!({ "path": path, "scope": write(&["~/work/**"]) });
        let trashed = call(&core, FILES, "fs.trash", params);
        assert_eq!(trashed, Ok(json!({})), "{path}");
    }
}

#[cfg(any(target_os = "macos", windows))]
#[test]
#[ignore = "moves files to the real Trash or Recycle Bin of whoever runs it"]
fn fs_trash_reaches_the_os_trash() {
    let home = crate::support::home();
    trash_both(&home);
    assert!(!home.join("work/a.txt").exists());
    assert!(!home.join("work/docs").exists());
}

#[cfg(all(
    unix,
    not(target_os = "macos"),
    not(target_os = "ios"),
    not(target_os = "android")
))]
mod freedesktop {
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;

    use crate::support::{home, names, text};

    const ROLE: &str = "DESK_CORE_TEST_CHILD";
    /// The home the child's core runs over.
    const HOME: &str = "DESK_CORE_TEST_HOME";

    /// The child program: trash the two entries through the bridge, failing (exit 101) otherwise.
    #[test]
    fn child() {
        let Ok(role) = std::env::var(ROLE) else {
            return;
        };
        assert_eq!(role, "fs-trash", "unknown role");
        super::trash_both(&PathBuf::from(std::env::var_os(HOME).unwrap()));
    }

    #[test]
    fn fs_trash_reaches_the_freedesktop_trash() {
        let home = home();
        let data_home = home.join(".xdg-data");
        fs::create_dir_all(&data_home).unwrap();
        let output = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "os_trash::freedesktop::child",
                "--nocapture",
                "--test-threads=1",
            ])
            .env(ROLE, "fs-trash")
            .env(HOME, &home)
            .env("XDG_DATA_HOME", &data_home)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "the child failed: {}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(names(&home.join("work")), Vec::<String>::new());
        let trashed = data_home.join("Trash/files");
        assert_eq!(names(&trashed), ["a.txt", "docs"]);
        assert_eq!(text(&trashed.join("a.txt")), "alpha");
        assert_eq!(text(&trashed.join("docs/b.md")), "bravo");
    }
}
