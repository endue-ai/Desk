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

/// `<a fresh folder under the temp folder>/missing`; neither folder is made.
fn missing_dir() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let (pid, n) = (std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed));
    let name = format!("desk-sys-login-{pid}-{nanos}-{n}");
    std::env::temp_dir().join(name).join("missing")
}

fn names(dir: &Path) -> Vec<String> {
    let entries = fs::read_dir(dir).unwrap();
    let mut names: Vec<String> = entries
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn registration(program: &str, args: &[&str]) -> Registration {
    let args = args.iter().map(|arg| (*arg).to_owned()).collect();
    Registration {
        program: PathBuf::from(program),
        args,
    }
}

#[test]
fn apply_registers_the_desk_when_wanted_and_removes_it_when_not() {
    assert_eq!((BACKGROUND, ID), ("--background", "ai.endue.desk"));
    let desk_program = desk(PROGRAM);
    assert_eq!(desk_program, registration(PROGRAM, &["--background"]));
    let fake = FakeLoginItems::new();

    assert_eq!(apply(&fake, true, &desk_program), Ok(Change::Registered));
    assert_eq!(fake.registration(), Some(desk_program.clone()));

    assert_eq!(apply(&fake, false, &desk_program), Ok(Change::Removed));
    assert_eq!(fake.registration(), None);
    assert_eq!(fake.writes(), 2);
}

#[test]
fn apply_writes_nothing_when_the_registration_already_matches() {
    let fake = FakeLoginItems::new();
    assert_eq!(apply(&fake, true, &desk(PROGRAM)), Ok(Change::Registered));

    assert_eq!(apply(&fake, true, &desk(PROGRAM)), Ok(Change::Unchanged));
    assert_eq!(fake.writes(), 1);
    assert_eq!(fake.registration(), Some(desk(PROGRAM)));

    let empty = FakeLoginItems::new();
    assert_eq!(apply(&empty, false, &desk(PROGRAM)), Ok(Change::Unchanged));
    assert_eq!(empty.writes(), 0);
}

#[test]
fn apply_replaces_the_registration_of_another_program() {
    let new = desk(PROGRAM);
    let fake = FakeLoginItems::new().with_registration(desk("/old/endue-desk"));
    let status = |registered, wanted, matches| {
        Ok(Status {
            registered,
            wanted,
            matches,
        })
    };

    assert_eq!(check(&fake, true, &new), status(true, true, false));
    assert_eq!(apply(&fake, true, &new), Ok(Change::Registered));
    assert_eq!(fake.registration(), Some(new.clone()));
    assert_eq!(check(&fake, true, &new), status(true, true, true));

    let fake = FakeLoginItems::new().with_registration(registration(PROGRAM, &[]));
    let change = apply(&fake, true, &new);
    assert_eq!(
        change,
        Ok(Change::Registered),
        "other arguments are another registration"
    );
    assert_eq!(fake.registration(), Some(new));
}

#[test]
fn check_says_whether_the_registration_matches_the_setting() {
    let desk_program = desk(PROGRAM);
    // (wanted, registered) and the `matches` it gives.
    for (wanted, registered, matches) in [
        (true, true, true),
        (true, false, false),
        (false, true, false),
        (false, false, true),
    ] {
        let mut fake = FakeLoginItems::new();
        if registered {
            fake = fake.with_registration(desk_program.clone());
        }
        let expected = Status {
            registered,
            wanted,
            matches,
        };
        assert_eq!(check(&fake, wanted, &desk_program), Ok(expected));
        assert_eq!(fake.writes(), 0, "check only reads");
    }
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
    let dir = missing_dir();
    let agent = LaunchAgent::in_dir(&dir, ID);
    let path = dir.join("ai.endue.desk.plist");
    assert_eq!(agent.path(), path);
    assert_eq!(agent.registered(), Ok(None));

    agent.register(&desk(PROGRAM)).unwrap();
    let text = fs::read_to_string(&path).unwrap();
    let head = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist ";
    assert!(text.starts_with(head), "{text}");
    // The lines trimmed and joined, so tags match whatever the indentation.
    let tags: String = text.lines().map(str::trim).collect();
    for expected in [
        "<plist version=\"1.0\"><dict>",
        "<key>Label</key><string>ai.endue.desk</string>",
        &format!("<key>ProgramArguments</key><array><string>{PROGRAM}</string>"),
        "<string>--background</string></array>",
        "<key>RunAtLoad</key><true/>",
        "<key>LimitLoadToSessionType</key><string>Aqua</string>",
        "</dict></plist>",
    ] {
        assert!(tags.contains(expected), "{expected} in {text}");
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
    let escaped = "<string>/Users/a b/Apps &amp; Tools/&lt;endue&gt; Desk.app/";
    assert!(text.contains(escaped), "{text}");
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
    let lint = Command::new("plutil").arg("-lint").arg(path).output();
    assert!(lint.as_ref().unwrap().status.success(), "{lint:?}");
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
    let dir = missing_dir();
    let autostart = XdgAutostart::in_dir(&dir, ID);
    let path = dir.join("ai.endue.desk.desktop");
    assert_eq!(autostart.path(), path);
    assert_eq!(autostart.registered(), Ok(None));

    let plain = desk("/opt/endue-desk/endue-desk");
    autostart.register(&plain).unwrap();
    let text = fs::read_to_string(&path).unwrap();
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(
        lines,
        [
            "[Desktop Entry]",
            "Type=Application",
            "Name=endue Desk",
            "Exec=\"/opt/endue-desk/endue-desk\" --background",
            "X-GNOME-Autostart-enabled=true",
        ]
    );
    assert_eq!(autostart.registered(), Ok(Some(plain.clone())));

    let odd = desk("/home/a b/$HOME/endue\\desk`x`/100% \"real\".AppImage");
    autostart.register(&odd).unwrap();
    let text = fs::read_to_string(&path).unwrap();
    let exec =
        r#"Exec="/home/a b/\\$HOME/endue\\\\desk\\`x\\`/100%% \\"real\\".AppImage" --background"#;
    assert!(text.contains(exec), "{text}");
    assert_eq!(autostart.registered(), Ok(Some(odd)));

    let with_args = registration("/opt/endue-desk/endue-desk", &[BACKGROUND, "a b", "50%"]);
    autostart.register(&with_args).unwrap();
    assert_eq!(autostart.registered(), Ok(Some(with_args)));
    assert_eq!(names(&dir), ["ai.endue.desk.desktop"], "no temp file");

    let by_hand = "# by hand\n[Desktop Entry]\nName=endue Desk\nExec = /opt/endue-desk/endue-desk --background\n";
    fs::write(&path, by_hand).unwrap();
    let read = autostart.registered();
    assert_eq!(read, Ok(Some(plain)), "an unquoted Exec reads back too");

    autostart.unregister().unwrap();
    assert!(!path.exists());
    assert_eq!(autostart.registered(), Ok(None));
    assert_eq!(autostart.unregister(), Ok(()));
    fs::remove_dir_all(dir.parent().unwrap()).unwrap();
}

#[test]
fn the_run_key_command_line_quotes_the_program_and_reads_back() {
    let desk_program = desk(r"C:\Program Files\endue Desk\endue-desk.exe");
    let line = run_key::command_line(&desk_program);
    let expected = r#""C:\Program Files\endue Desk\endue-desk.exe" --background"#;
    assert_eq!(line, expected);
    assert_eq!(run_key::parse(&line), desk_program);

    let odd = registration(
        r"C:\endue\endue-desk.exe",
        &[BACKGROUND, "two words", r#"say "hi""#, r"C:\a folder\", ""],
    );
    assert_eq!(run_key::parse(&run_key::command_line(&odd)), odd);
    let unquoted = run_key::parse(r"C:\endue\endue-desk.exe --background");
    assert_eq!(
        unquoted,
        desk(r"C:\endue\endue-desk.exe"),
        "an unquoted program reads back too"
    );
}

#[test]
fn a_login_start_is_told_by_the_background_argument() {
    assert!(login::launched_at_login(["endue-desk", "--background"]));
    assert!(!login::launched_at_login(["endue-desk"]));
    assert!(!login::launched_at_login(["endue-desk", "/tmp/a.md"]));
    let args_os = [OsString::from("endue-desk"), OsString::from(BACKGROUND)];
    assert!(login::launched_at_login(args_os));
}

#[test]
fn the_program_is_the_appimage_when_the_desk_runs_from_one() {
    let exe = PathBuf::from("/tmp/.mount_endue/usr/bin/endue-desk");
    let appimage = OsString::from("/home/a/Apps/endue-desk.AppImage");

    let program = login::program_from(exe.clone(), Some(appimage));
    assert_eq!(program, PathBuf::from("/home/a/Apps/endue-desk.AppImage"));
    assert_eq!(login::program_from(exe.clone(), None), exe);
    assert_eq!(login::program_from(exe.clone(), Some(OsString::new())), exe);
    if std::env::var_os("APPIMAGE").is_none() {
        assert_eq!(login::program(), Ok(std::env::current_exe().unwrap()));
    }
}

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
#[test]
fn os_names_the_platform_backend() {
    let (name, location) = expected_backend();
    let file = Path::new(&location);
    let state = || (file.exists(), file.parent().is_some_and(Path::exists));
    let before = state();

    let items = login::os(ID).unwrap();

    assert_eq!((items.name(), items.location()), (name, location.clone()));
    assert_eq!(state(), before, "naming the backend writes nothing");
}

/// The backend's name and where it keeps the registration, worked out from the environment.
#[cfg(target_os = "macos")]
fn expected_backend() -> (&'static str, String) {
    let home = PathBuf::from(std::env::var_os("HOME").unwrap());
    let plist = home.join("Library/LaunchAgents/ai.endue.desk.plist");
    ("launch-agent", plist.display().to_string())
}

#[cfg(windows)]
fn expected_backend() -> (&'static str, String) {
    let value = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run\ai.endue.desk";
    ("run-key", value.to_owned())
}

#[cfg(target_os = "linux")]
fn expected_backend() -> (&'static str, String) {
    let home = || PathBuf::from(std::env::var_os("HOME").unwrap()).join(".config");
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|config| config.is_absolute())
        .unwrap_or_else(home);
    let entry = config.join("autostart/ai.endue.desk.desktop");
    ("xdg-autostart", entry.display().to_string())
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

    let desk_program = desk(r"C:\Program Files\endue Desk\endue-desk.exe");
    items.register(&desk_program).unwrap();
    let run = windows_registry::CURRENT_USER.open(&key).unwrap();
    let value = run.get_string(ID).unwrap();
    let expected = r#""C:\Program Files\endue Desk\endue-desk.exe" --background"#;
    assert_eq!(value, expected);
    assert_eq!(items.registered(), Ok(Some(desk_program.clone())));
    assert_eq!(apply(&items, true, &desk_program), Ok(Change::Unchanged));

    assert_eq!(apply(&items, false, &desk_program), Ok(Change::Removed));
    assert_eq!(items.registered(), Ok(None));
    assert_eq!(items.unregister(), Ok(()));
    drop(run);
    drop(cleanup);
    assert!(windows_registry::CURRENT_USER.open(&key).is_err());
}
