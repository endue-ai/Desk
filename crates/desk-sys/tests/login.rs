//! desk-sys login items (feature `login`): `apply` and `check` through `FakeLoginItems`, the macOS
//! LaunchAgent and the Linux autostart entry in a temp folder, the Windows Run key's command line,
//! and how a start at login and the registered program are told.
//!
//! No test touches the person's login items: the fake keeps its registration in memory, the file
//! backends write under a temp folder, `os()` is only named, and the Windows test uses a key of its
//! own and deletes it.

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use desk_sys::ErrorCode;
use desk_sys::login::fake::FakeLoginItems;
use desk_sys::login::{
    self, BACKGROUND, Change, ID, LaunchAgent, LoginItems, Registration, Status, XdgAutostart,
    apply, check, desk, run_key,
};

const PROGRAM: &str = "/Applications/endue Desk.app/Contents/MacOS/endue-desk";

/// Tests run in parallel threads: the counter keeps their folders apart.
static NEXT: AtomicU32 = AtomicU32::new(0);

/// A fresh folder name under the temp folder; the folder itself is not made.
fn temp_dir() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("desk-sys-login-{}-{nanos}-{n}", std::process::id()))
}

fn names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

/// The file's lines trimmed and joined, so tags can be matched whatever the indentation.
fn compact(text: &str) -> String {
    text.lines().map(str::trim).collect()
}

fn status(registered: bool, wanted: bool, matches: bool) -> Status {
    Status {
        registered,
        wanted,
        matches,
    }
}

#[test]
fn apply_registers_the_desk_when_wanted_and_removes_it_when_not() {
    assert_eq!(BACKGROUND, "--background");
    assert_eq!(ID, "ai.endue.desk");
    let registration = desk(PROGRAM);
    assert_eq!(
        registration,
        Registration {
            program: PathBuf::from(PROGRAM),
            args: vec!["--background".to_owned()],
        }
    );
    let fake = FakeLoginItems::new();

    assert_eq!(apply(&fake, true, &registration), Ok(Change::Registered));
    assert_eq!(fake.registration(), Some(registration.clone()));

    assert_eq!(apply(&fake, false, &registration), Ok(Change::Removed));
    assert_eq!(fake.registration(), None);
    assert_eq!(fake.writes(), 2);
}

#[test]
fn apply_writes_nothing_when_the_registration_already_matches() {
    let registration = desk(PROGRAM);
    let fake = FakeLoginItems::new();
    assert_eq!(apply(&fake, true, &registration), Ok(Change::Registered));

    assert_eq!(apply(&fake, true, &registration), Ok(Change::Unchanged));
    assert_eq!(fake.writes(), 1);
    assert_eq!(fake.registration(), Some(registration.clone()));

    let empty = FakeLoginItems::new();
    assert_eq!(apply(&empty, false, &registration), Ok(Change::Unchanged));
    assert_eq!(empty.writes(), 0);
}

#[test]
fn apply_replaces_the_registration_of_another_program() {
    let old = desk("/old/endue-desk");
    let new = desk(PROGRAM);
    let fake = FakeLoginItems::new().with_registration(old);

    assert_eq!(check(&fake, true, &new), Ok(status(true, true, false)));
    assert_eq!(apply(&fake, true, &new), Ok(Change::Registered));
    assert_eq!(fake.registration(), Some(new.clone()));
    assert_eq!(check(&fake, true, &new), Ok(status(true, true, true)));

    let without_argument = Registration {
        program: PathBuf::from(PROGRAM),
        args: Vec::new(),
    };
    let fake = FakeLoginItems::new().with_registration(without_argument);
    assert_eq!(
        apply(&fake, true, &new),
        Ok(Change::Registered),
        "the same program with other arguments is another registration"
    );
    assert_eq!(fake.registration(), Some(new));
}

#[test]
fn check_says_whether_the_registration_matches_the_setting() {
    let registration = desk(PROGRAM);
    let registered = || FakeLoginItems::new().with_registration(registration.clone());

    assert_eq!(
        check(&registered(), true, &registration),
        Ok(status(true, true, true))
    );
    assert_eq!(
        check(&FakeLoginItems::new(), true, &registration),
        Ok(status(false, true, false))
    );
    assert_eq!(
        check(&registered(), false, &registration),
        Ok(status(true, false, false))
    );
    assert_eq!(
        check(&FakeLoginItems::new(), false, &registration),
        Ok(status(false, false, true))
    );
}

#[test]
fn a_failing_backend_is_an_io_error_and_changes_nothing() {
    let old = desk("/old/endue-desk");
    let fake = FakeLoginItems::new()
        .with_registration(old.clone())
        .failing();

    let err = apply(&fake, true, &desk(PROGRAM)).unwrap_err();
    assert_eq!(err.code, ErrorCode::IoError, "{err}");
    assert_eq!(fake.registration(), Some(old.clone()));

    let err = apply(&fake, false, &desk(PROGRAM)).unwrap_err();
    assert_eq!(err.code, ErrorCode::IoError, "{err}");
    assert_eq!(fake.registration(), Some(old));
    assert_eq!(fake.writes(), 0);
}

#[test]
fn the_launch_agent_starts_the_program_in_the_background_at_login() {
    let dir = temp_dir().join("missing");
    let agent = LaunchAgent::in_dir(&dir, ID);
    let path = dir.join("ai.endue.desk.plist");
    assert_eq!(agent.path(), path);
    assert_eq!(agent.registered(), Ok(None));

    agent.register(&desk(PROGRAM)).unwrap();
    let text = fs::read_to_string(&path).unwrap();
    assert!(
        text.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist "),
        "{text}"
    );
    let tags = compact(&text);
    for expected in [
        "<plist version=\"1.0\"><dict>".to_owned(),
        "<key>Label</key><string>ai.endue.desk</string>".to_owned(),
        format!(
            "<key>ProgramArguments</key><array><string>{PROGRAM}</string>\
             <string>--background</string></array>"
        ),
        "<key>RunAtLoad</key><true/>".to_owned(),
        "<key>LimitLoadToSessionType</key><string>Aqua</string>".to_owned(),
        "</dict></plist>".to_owned(),
    ] {
        assert!(tags.contains(&expected), "{expected} in {text}");
    }
    assert_eq!(agent.registered(), Ok(Some(desk(PROGRAM))));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o022, 0, "launchd skips a plist others can write");
    }

    let odd = desk("/Users/a b/Apps & Tools/<endue> Desk.app/Contents/MacOS/endue-desk");
    agent.register(&odd).unwrap();
    let text = fs::read_to_string(&path).unwrap();
    assert!(
        text.contains(
            "<string>/Users/a b/Apps &amp; Tools/&lt;endue&gt; Desk.app/Contents/MacOS/endue-desk\
             </string>"
        ),
        "{text}"
    );
    assert_eq!(agent.registered(), Ok(Some(odd.clone())));
    #[cfg(target_os = "macos")]
    plutil_reads(&path, &odd.program);
    assert_eq!(names(&dir), ["ai.endue.desk.plist"], "no temp file is left");

    let err = agent.register(&desk("/Users/a\nb/endue-desk")).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidParams, "{err}");
    assert_eq!(
        agent.registered(),
        Ok(Some(odd)),
        "a refused write changes nothing"
    );

    agent.unregister().unwrap();
    assert!(!path.exists());
    assert_eq!(agent.registered(), Ok(None));
    assert_eq!(agent.unregister(), Ok(()));

    fs::write(&path, "not a plist").unwrap();
    let unreadable = agent.registered().unwrap().unwrap();
    assert_eq!(unreadable.program, PathBuf::new(), "a file it cannot read");
    assert_eq!(apply(&agent, true, &desk(PROGRAM)), Ok(Change::Registered));
    assert_eq!(agent.registered(), Ok(Some(desk(PROGRAM))));
    fs::remove_dir_all(dir.parent().unwrap()).unwrap();
}

/// Apple's own parser reads the plist back: valid, with the program as its first argument.
#[cfg(target_os = "macos")]
fn plutil_reads(path: &Path, program: &Path) {
    use std::process::Command;
    let lint = Command::new("plutil")
        .arg("-lint")
        .arg(path)
        .output()
        .unwrap();
    assert!(lint.status.success(), "{lint:?}");
    let first = Command::new("plutil")
        .args(["-extract", "ProgramArguments.0", "raw", "-o", "-"])
        .arg(path)
        .output()
        .unwrap();
    assert!(first.status.success(), "{first:?}");
    let first = String::from_utf8(first.stdout).unwrap();
    assert_eq!(Path::new(first.trim_end_matches('\n')), program);
}

#[test]
fn the_autostart_entry_quotes_the_program_and_reads_back() {
    let dir = temp_dir().join("missing");
    let autostart = XdgAutostart::in_dir(&dir, ID);
    let path = dir.join("ai.endue.desk.desktop");
    assert_eq!(autostart.path(), path);
    assert_eq!(autostart.registered(), Ok(None));

    let plain = desk("/opt/endue-desk/endue-desk");
    autostart.register(&plain).unwrap();
    let text = fs::read_to_string(&path).unwrap();
    assert_eq!(
        text.lines().collect::<Vec<_>>(),
        [
            "[Desktop Entry]",
            "Type=Application",
            "Name=endue Desk",
            "Exec=\"/opt/endue-desk/endue-desk\" --background",
            "X-GNOME-Autostart-enabled=true",
        ]
    );
    assert_eq!(autostart.registered(), Ok(Some(plain)));

    let odd = desk("/home/a b/$HOME/endue\\desk`x`/100% \"real\".AppImage");
    autostart.register(&odd).unwrap();
    let text = fs::read_to_string(&path).unwrap();
    assert!(
        text.contains(
            r#"Exec="/home/a b/\\$HOME/endue\\\\desk\\`x\\`/100%% \\"real\\".AppImage" --background"#
        ),
        "{text}"
    );
    assert_eq!(autostart.registered(), Ok(Some(odd)));
    let with_arguments = Registration {
        program: PathBuf::from("/opt/endue-desk/endue-desk"),
        args: vec![
            BACKGROUND.to_owned(),
            "two words".to_owned(),
            "50%".to_owned(),
        ],
    };
    autostart.register(&with_arguments).unwrap();
    assert_eq!(autostart.registered(), Ok(Some(with_arguments)));
    assert_eq!(
        names(&dir),
        ["ai.endue.desk.desktop"],
        "no temp file is left"
    );

    fs::write(
        &path,
        "# written by hand\n[Desktop Entry]\nName=endue Desk\nExec = /opt/endue-desk/endue-desk --background\n",
    )
    .unwrap();
    assert_eq!(
        autostart.registered(),
        Ok(Some(desk("/opt/endue-desk/endue-desk"))),
        "an unquoted Exec reads back too"
    );

    autostart.unregister().unwrap();
    assert!(!path.exists());
    assert_eq!(autostart.registered(), Ok(None));
    assert_eq!(autostart.unregister(), Ok(()));
    fs::remove_dir_all(dir.parent().unwrap()).unwrap();
}

#[test]
fn the_run_key_command_line_quotes_the_program_and_reads_back() {
    let registration = desk(r"C:\Program Files\endue Desk\endue-desk.exe");
    let line = run_key::command_line(&registration);
    assert_eq!(
        line,
        r#""C:\Program Files\endue Desk\endue-desk.exe" --background"#
    );
    assert_eq!(run_key::parse(&line), registration);

    let odd = Registration {
        program: PathBuf::from(r"C:\endue\endue-desk.exe"),
        args: vec![
            BACKGROUND.to_owned(),
            "two words".to_owned(),
            r#"say "hi""#.to_owned(),
            r"C:\a folder\".to_owned(),
            String::new(),
        ],
    };
    assert_eq!(run_key::parse(&run_key::command_line(&odd)), odd);
    assert_eq!(
        run_key::parse(r"C:\endue\endue-desk.exe --background"),
        desk(r"C:\endue\endue-desk.exe"),
        "an unquoted program reads back too"
    );
}

#[test]
fn a_login_start_is_told_by_the_background_argument() {
    assert!(login::launched_at_login(["endue-desk", "--background"]));
    assert!(!login::launched_at_login(["endue-desk"]));
    assert!(!login::launched_at_login(["endue-desk", "/tmp/a.md"]));
    assert!(login::launched_at_login([
        OsString::from("endue-desk"),
        OsString::from(BACKGROUND),
    ]));
}

#[test]
fn the_program_is_the_appimage_when_the_desk_runs_from_one() {
    let exe = PathBuf::from("/tmp/.mount_endue/usr/bin/endue-desk");
    let appimage = OsString::from("/home/a/Apps/endue-desk.AppImage");

    assert_eq!(
        login::program_from(exe.clone(), Some(appimage)),
        PathBuf::from("/home/a/Apps/endue-desk.AppImage")
    );
    assert_eq!(login::program_from(exe.clone(), None), exe);
    assert_eq!(login::program_from(exe.clone(), Some(OsString::new())), exe);
    if std::env::var_os("APPIMAGE").is_none() {
        assert_eq!(login::program(), Ok(std::env::current_exe().unwrap()));
    }
}

#[test]
fn os_names_the_platform_backend() {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let expected = expected_file();
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let existed = (expected.exists(), expected.parent().unwrap().exists());

    let items = match login::os(ID) {
        Ok(items) => items,
        Err(err) => {
            assert!(cfg!(not(any(
                target_os = "macos",
                windows,
                target_os = "linux"
            ))));
            assert_eq!(err.code, ErrorCode::Unsupported);
            return;
        }
    };
    let location = items.location();

    #[cfg(target_os = "macos")]
    assert_eq!(items.name(), "launch-agent");
    #[cfg(target_os = "linux")]
    assert_eq!(items.name(), "xdg-autostart");
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        assert_eq!(Path::new(&location), expected);
        let now = (expected.exists(), expected.parent().unwrap().exists());
        assert_eq!(now, existed, "naming the backend writes nothing");
    }
    #[cfg(windows)]
    {
        assert_eq!(items.name(), "run-key");
        assert_eq!(
            location,
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run\ai.endue.desk"
        );
    }
}

/// Where the OS backend keeps the registration, worked out from the environment.
#[cfg(target_os = "macos")]
fn expected_file() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").unwrap())
        .join("Library/LaunchAgents/ai.endue.desk.plist")
}

#[cfg(target_os = "linux")]
fn expected_file() -> PathBuf {
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .unwrap_or_else(|| PathBuf::from(std::env::var_os("HOME").unwrap()).join(".config"));
    config.join("autostart/ai.endue.desk.desktop")
}

#[cfg(windows)]
#[test]
fn on_windows_the_run_key_registers_and_removes_a_value() {
    /// Deletes the test key however the test ends.
    struct Cleanup(String);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = windows_registry::CURRENT_USER.remove_tree(&self.0);
        }
    }

    let key = format!(r"Software\endue\desk-sys-test-{}", std::process::id());
    let cleanup = Cleanup(key.clone());
    let items = login::RunKey::at(&key, ID);
    assert_eq!(items.name(), "run-key");
    assert_eq!(items.location(), format!(r"HKCU\{key}\ai.endue.desk"));
    assert_eq!(items.registered(), Ok(None));
    assert_eq!(items.unregister(), Ok(()), "nothing to remove is fine");

    let registration = desk(r"C:\Program Files\endue Desk\endue-desk.exe");
    items.register(&registration).unwrap();
    let value = windows_registry::CURRENT_USER
        .open(&key)
        .unwrap()
        .get_string(ID)
        .unwrap();
    assert_eq!(
        value,
        r#""C:\Program Files\endue Desk\endue-desk.exe" --background"#
    );
    assert_eq!(items.registered(), Ok(Some(registration.clone())));
    assert_eq!(apply(&items, true, &registration), Ok(Change::Unchanged));

    assert_eq!(apply(&items, false, &registration), Ok(Change::Removed));
    assert_eq!(items.registered(), Ok(None));
    assert_eq!(items.unregister(), Ok(()));
    drop(cleanup);
    assert!(windows_registry::CURRENT_USER.open(&key).is_err());
}
