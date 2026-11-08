//! Links and files handed to the system: open an http, https or mailto URL in its default app, or
//! show a file selected in its folder in the file manager. Only those three schemes ever reach the
//! OS (`link`), always as one argument and never through a shell; a path is only revealed, never
//! opened or run. No permission checks happen here: desk-core authorizes every call first (ADR 0047).

use std::io::{self, Read};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

pub use desk_bridge::ShellScheme;

use crate::{Error, ErrorCode};

#[cfg(windows)]
mod windows;

/// Hands links and files to the system. desk-core holds one (`SystemOpener` unless a test gives a
/// fake), so a test never launches a browser.
pub trait Opener: Send + Sync {
    /// Open a URL that `link` accepted in the system's default app for its scheme.
    fn open_url(&self, url: &str) -> Result<(), Error>;
    /// Show a file or folder selected in its folder in the file manager. Never opens it.
    fn reveal(&self, path: &Path) -> Result<(), Error>;
}

/// The system's opener: runs the plan for the OS it was built for, first launch that works wins.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemOpener;

impl Opener for SystemOpener {
    fn open_url(&self, url: &str) -> Result<(), Error> {
        run(&open_plan(Os::current(), url))
    }

    fn reveal(&self, path: &Path) -> Result<(), Error> {
        run(&reveal_plan(Os::current(), path))
    }
}

/// A URL the system may be handed: its scheme and the URL as parsed (WHATWG), lowercase scheme and
/// host, spaces and quotes escaped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Link {
    pub scheme: ShellScheme,
    pub url: String,
}

/// Check a link: an absolute http, https or mailto URL without control characters. Anything else
/// (`file:`, `javascript:`, `data:`, a custom scheme, a relative URL) is `invalid_params`.
pub fn link(target: &str) -> Result<Link, Error> {
    let invalid = |why: String| Error::new(ErrorCode::InvalidParams, why);
    if let Some(c) = target.chars().find(|c| c.is_control()) {
        let code = u32::from(c);
        return Err(invalid(format!(
            "the link holds a control character (U+{code:04X})"
        )));
    }
    let url = url::Url::parse(target)
        .map_err(|why| invalid(format!("{target:?} is not an absolute URL: {why}")))?;
    let scheme = match url.scheme() {
        "http" => ShellScheme::Http,
        "https" => ShellScheme::Https,
        "mailto" => ShellScheme::Mailto,
        other => {
            return Err(invalid(format!(
                "{other}: links are never opened; only http, https and mailto are"
            )));
        }
    };
    Ok(Link {
        scheme,
        url: url.into(),
    })
}

/// The systems with a plan of their own; every other Unix plans as Linux does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    MacOs,
    Linux,
    Windows,
}

impl Os {
    /// The OS this build runs on.
    pub fn current() -> Self {
        if cfg!(target_os = "macos") {
            Os::MacOs
        } else if cfg!(windows) {
            Os::Windows
        } else {
            Os::Linux
        }
    }
}

/// One way to ask the OS, tried in plan order until one works.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Launch {
    /// Run `program` directly with `args`, never through a shell. With `checks_status` a failed
    /// exit means the launch failed (explorer exits 1 even when it showed the file).
    Program {
        program: &'static str,
        args: Vec<String>,
        checks_status: bool,
    },
    /// `ShellExecuteW` with the `open` verb (Windows).
    ShellExecute(String),
}

fn program(program: &'static str, args: Vec<String>) -> Launch {
    Launch::Program {
        program,
        args,
        checks_status: true,
    }
}

/// How `os` opens a checked URL.
pub fn open_plan(os: Os, url: &str) -> Vec<Launch> {
    match os {
        Os::MacOs => vec![program("open", vec![url.to_owned()])],
        Os::Linux => vec![program("xdg-open", vec![url.to_owned()])],
        Os::Windows => vec![Launch::ShellExecute(url.to_owned())],
    }
}

/// How `os` shows an absolute path selected in its folder.
pub fn reveal_plan(os: Os, path: &Path) -> Vec<Launch> {
    let shown = path.to_string_lossy().into_owned();
    match os {
        Os::MacOs => vec![program("open", vec!["-R".to_owned(), shown])],
        Os::Linux => {
            let folder = path.parent().unwrap_or(path).to_string_lossy().into_owned();
            let show_items = [
                "--session",
                "--print-reply",
                "--reply-timeout=3000",
                "--dest=org.freedesktop.FileManager1",
                "--type=method_call",
                "/org/freedesktop/FileManager1",
                "org.freedesktop.FileManager1.ShowItems",
            ];
            let mut args: Vec<String> = show_items.iter().map(|arg| arg.to_string()).collect();
            args.push(format!("array:string:{}", file_uri(&shown)));
            args.push("string:".to_owned());
            vec![
                program("dbus-send", args),
                program("xdg-open", vec![folder]),
            ]
        }
        Os::Windows => {
            // One argument, quoted whole: explorer splits its own command line at commas. Windows
            // paths cannot hold a quote.
            let windows_path = shown.replace('/', "\\");
            vec![Launch::Program {
                program: "explorer",
                args: vec![format!("/select,\"{windows_path}\"")],
                checks_status: false,
            }]
        }
    }
}

/// `file://` and the path with every byte but unreserved ones and `/` percent-encoded: a comma
/// would split dbus-send's array.
fn file_uri(path: &str) -> String {
    let mut uri = String::from("file://");
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~/".contains(&byte) {
            uri.push(char::from(byte));
        } else {
            uri.push_str(&format!("%{byte:02X}"));
        }
    }
    uri
}

/// How long a launched program may take before it counts as started (xdg-open may stay while a
/// browser runs); it is reaped later.
const SETTLE: Duration = Duration::from_secs(5);

fn run(plan: &[Launch]) -> Result<(), Error> {
    let mut failed = Error::new(ErrorCode::Unsupported, "this system has no way to open it");
    for launch in plan {
        match launch_one(launch) {
            Ok(()) => return Ok(()),
            Err(why) => failed = why,
        }
    }
    Err(failed)
}

fn launch_one(launch: &Launch) -> Result<(), Error> {
    match launch {
        Launch::ShellExecute(file) => shell_execute(file),
        Launch::Program {
            program,
            args,
            checks_status,
        } => {
            let mut command = Command::new(program);
            add_args(&mut command, args);
            command
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::piped());
            let child = command.spawn().map_err(|err| Error::io(&err, program))?;
            settle(child, program, *checks_status)
        }
    }
}

#[cfg(windows)]
fn add_args(command: &mut Command, args: &[String]) {
    use std::os::windows::process::CommandExt;
    for arg in args {
        command.raw_arg(arg);
    }
}

#[cfg(not(windows))]
fn add_args(command: &mut Command, args: &[String]) {
    command.args(args);
}

#[cfg(windows)]
fn shell_execute(file: &str) -> Result<(), Error> {
    windows::shell_execute(file)
}

#[cfg(not(windows))]
fn shell_execute(_file: &str) -> Result<(), Error> {
    Err(Error::new(
        ErrorCode::Unsupported,
        "ShellExecuteW is Windows only",
    ))
}

/// Wait for the program to exit, at most `SETTLE`; its exit status decides when it `checks`.
fn settle(mut child: Child, program: &str, checks: bool) -> Result<(), Error> {
    let said = said(&mut child);
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() || !checks => return Ok(()),
            Ok(Some(status)) => {
                let text = said
                    .recv_timeout(Duration::from_millis(500))
                    .unwrap_or_default();
                let message = format!("{program} could not open it ({status}): {text}");
                return Err(Error::new(
                    ErrorCode::IoError,
                    message.trim_end_matches(": "),
                ));
            }
            Ok(None) if started.elapsed() >= SETTLE => {
                thread::spawn(move || child.wait());
                return Ok(());
            }
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(err) => return Err(Error::io(&err, program)),
        }
    }
}

/// The first 4 KiB the program writes to stderr, once it closes or fills them; the rest is drained,
/// so a chatty program never blocks on a full pipe.
fn said(child: &mut Child) -> mpsc::Receiver<String> {
    let (tell, told) = mpsc::channel();
    if let Some(mut stderr) = child.stderr.take() {
        thread::spawn(move || {
            let mut head = Vec::new();
            let _ = (&mut stderr).take(4096).read_to_end(&mut head);
            let _ = tell.send(String::from_utf8_lossy(&head).trim().to_owned());
            let _ = io::copy(&mut stderr, &mut io::sink());
        });
    }
    told
}
