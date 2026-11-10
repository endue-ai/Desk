//! Start at login: the desk registered with the OS as a login item, or not. Whether it should be is
//! a setting decided above this crate; here `apply` makes the registration match it, writing only
//! when what is registered differs, and `check` says whether it does. `os(id)` is a per-user
//! LaunchAgent on macOS, the Run key on Windows and an XDG autostart entry on Linux; `fake` keeps a
//! registration in memory for tests, here and in the crates above.
//!
//! A login item starts the desk with one argument, `BACKGROUND`, so a start at login can be told
//! from a click (`launched_at_login`). Every OS names the registration by the app identifier `ID`.

use std::ffi::{OsStr, OsString};
use std::fmt;
use std::path::PathBuf;

use crate::{Error, ErrorCode};

pub mod fake;
mod file;
mod launch_agent;
pub mod run_key;
mod xdg_autostart;

pub use launch_agent::LaunchAgent;
#[cfg(windows)]
pub use run_key::RunKey;
pub use xdg_autostart::XdgAutostart;

/// The app identifier (`identifier` in `apps/desk/shell/packager/packager.json`) that names the
/// registration on every OS.
pub const ID: &str = "ai.endue.desk";

/// The one argument a login item starts the desk with.
pub const BACKGROUND: &str = "--background";

/// What a login item starts: a program and its arguments.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Registration {
    pub program: PathBuf,
    pub args: Vec<String>,
}

/// The desk's registration: `program` with the one argument `BACKGROUND`.
pub fn desk(program: impl Into<PathBuf>) -> Registration {
    Registration {
        program: program.into(),
        args: vec![BACKGROUND.to_owned()],
    }
}

/// What `apply` did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Change {
    /// Wanted and not registered as asked, so it was written.
    Registered,
    /// Not wanted and registered, so it was removed.
    Removed,
    /// It already matched; nothing was written.
    Unchanged,
}

/// What `check` found: whether something is registered, whether it is wanted, and whether the
/// registration matches (the desk's own when wanted, nothing when not).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Status {
    pub registered: bool,
    pub wanted: bool,
    pub matches: bool,
}

/// The OS's login items, for the one registration a backend is made for. A missing registration is
/// `Ok(None)`, never `not_found`; a file or registry failure is `io_error` naming the path or key.
pub trait LoginItems: Send + Sync {
    /// The backend's name: `launch-agent`, `run-key`, `xdg-autostart` or `fake`.
    fn name(&self) -> &'static str;
    /// Where the registration lives: a file's path, or a registry key and value.
    fn location(&self) -> String;
    /// What is registered. A registration it cannot read back is one with an empty `program`, which
    /// matches no desk, so `apply` rewrites or removes it.
    fn registered(&self) -> Result<Option<Registration>, Error>;
    /// Register `registration`, replacing whatever is registered. `invalid_params` for a program or
    /// argument that is not UTF-8 or holds a control character, with nothing written.
    fn register(&self, registration: &Registration) -> Result<(), Error>;
    /// Remove the registration; `Ok` when there is none.
    fn unregister(&self) -> Result<(), Error>;
}

/// Make the registration match the setting: register `registration` when `wanted` and what is
/// registered differs in program or arguments, remove it when not `wanted`, and write nothing when
/// it already matches. A failure leaves the registration as the backend had it.
pub fn apply(
    items: &dyn LoginItems,
    wanted: bool,
    registration: &Registration,
) -> Result<Change, Error> {
    match (wanted, items.registered()?) {
        (true, Some(current)) if current == *registration => Ok(Change::Unchanged),
        (true, _) => items.register(registration).map(|()| Change::Registered),
        (false, Some(_)) => items.unregister().map(|()| Change::Removed),
        (false, None) => Ok(Change::Unchanged),
    }
}

/// Whether the registration matches the setting, for `desk doctor`. Reads only.
pub fn check(
    items: &dyn LoginItems,
    wanted: bool,
    registration: &Registration,
) -> Result<Status, Error> {
    let current = items.registered()?;
    let matches = match &current {
        Some(current) => wanted && current == registration,
        None => !wanted,
    };
    Ok(Status {
        registered: current.is_some(),
        wanted,
        matches,
    })
}

/// Whether the desk was started by its login item: an argument after the program is `BACKGROUND`.
/// Takes the whole command line, program first, as `std::env::args_os()` gives it.
pub fn launched_at_login<I>(args: I) -> bool
where
    I: IntoIterator,
    I::Item: AsRef<OsStr>,
{
    args.into_iter()
        .skip(1)
        .any(|arg| arg.as_ref() == OsStr::new(BACKGROUND))
}

/// The program a login item should start: this executable, or the AppImage it runs from on Linux.
pub fn program() -> Result<PathBuf, Error> {
    let exe = std::env::current_exe().map_err(|err| io_error(err, "the desk's executable"))?;
    #[cfg(target_os = "linux")]
    let appimage = std::env::var_os("APPIMAGE");
    #[cfg(not(target_os = "linux"))]
    let appimage = None;
    Ok(program_from(exe, appimage))
}

/// `appimage` (the `APPIMAGE` variable) when it is set and not empty, `exe` otherwise: inside an
/// AppImage the executable lives in a mount that is gone after the desk quits.
pub fn program_from(exe: PathBuf, appimage: Option<OsString>) -> PathBuf {
    match appimage {
        Some(appimage) if !appimage.is_empty() => PathBuf::from(appimage),
        _ => exe,
    }
}

/// The OS login items for the registration named `id`: `~/Library/LaunchAgents/<id>.plist`.
/// Nothing is written until `register`.
#[cfg(target_os = "macos")]
pub fn os(id: &str) -> Result<Box<dyn LoginItems>, Error> {
    Ok(Box::new(LaunchAgent::user(id)?))
}

/// The OS login items for the registration named `id`: the value `id` under
/// `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
#[cfg(windows)]
pub fn os(id: &str) -> Result<Box<dyn LoginItems>, Error> {
    Ok(Box::new(RunKey::user(id)))
}

/// The OS login items for the registration named `id`: `$XDG_CONFIG_HOME/autostart/<id>.desktop`
/// (`~/.config/autostart` without it). Nothing is written until `register`.
#[cfg(target_os = "linux")]
pub fn os(id: &str) -> Result<Box<dyn LoginItems>, Error> {
    Ok(Box::new(XdgAutostart::user(id)?))
}

/// The OS login items: none here.
#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
pub fn os(id: &str) -> Result<Box<dyn LoginItems>, Error> {
    let _ = id;
    Err(Error::new(
        ErrorCode::Unsupported,
        "start at login exists on macOS, Windows and Linux only",
    ))
}

/// A file or registry failure: always `io_error`, with `context` (the path or key) in the message.
pub(crate) fn io_error(err: impl fmt::Display, context: impl fmt::Display) -> Error {
    Error::new(ErrorCode::IoError, format!("{context}: {err}"))
}

/// The registration as text a login item can hold: a program that is not empty, and a program and
/// arguments in UTF-8 without control characters. `invalid_params` otherwise.
pub(crate) fn text(registration: &Registration) -> Result<(&str, &[String]), Error> {
    let program = registration
        .program
        .to_str()
        .ok_or_else(|| invalid(format!("{} is not UTF-8", registration.program.display())))?;
    if program.is_empty() {
        return Err(invalid("a login item needs a program".to_owned()));
    }
    for word in std::iter::once(program).chain(registration.args.iter().map(String::as_str)) {
        if word.chars().any(char::is_control) {
            return Err(invalid(format!(
                "{word:?} holds a control character a login item cannot hold"
            )));
        }
    }
    Ok((program, &registration.args))
}

fn invalid(message: String) -> Error {
    Error::new(ErrorCode::InvalidParams, message)
}

/// The registration a backend reads back from text it cannot make sense of: no program, so it
/// matches no desk.
pub(crate) fn unreadable() -> Registration {
    Registration {
        program: PathBuf::new(),
        args: Vec::new(),
    }
}
