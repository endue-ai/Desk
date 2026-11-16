//! `desk open <path|link>` (#310): hand a file or an `endue://` link to the running desk, or start
//! the desk with it. A path is made absolute against the folder `desk` runs in; a link is checked
//! against the v1 grammar first (`desk-link`), and one the desk would refuse starts nothing. The desk
//! itself takes it from there: a second start hands its argument to the running desk and quits
//! (`apps/desk/shell/src/instance.rs`); on macOS `open` hands it over as the OS does from Finder.
//! `DESK_APP` names the desk's executable instead of the installed one; it, and the installed one
//! looked for, must be absolute paths, so a program planted in the folder `desk` runs in never runs.

use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

/// What the desk is handed for `arg`: a canonical link, or an absolute path.
pub fn target(arg: &str, cwd: &Path) -> Result<String, String> {
    if desk_link::is_link(arg) {
        return desk_link::parse(arg)
            .map(|link| link.to_string())
            .map_err(|why| why.0);
    }
    if arg.is_empty() || arg.contains('\0') {
        return Err("Name a file or an endue:// link to open.".to_owned());
    }
    let path = cwd.join(arg);
    let path = std::path::absolute(&path).unwrap_or(path);
    Ok(path.to_string_lossy().into_owned())
}

/// The first of `candidates` that is an absolute path to a file: never one relative to the folder
/// `desk` runs in, where anyone could have put a program of that name.
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn first_absolute(candidates: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    candidates
        .into_iter()
        .find(|path| path.is_absolute() && path.is_file())
}

/// How the desk is started with `target`, or why it cannot be.
fn command(target: &str) -> Result<Command, String> {
    let mut command = match std::env::var_os("DESK_APP").filter(|app| !app.is_empty()) {
        Some(app) => {
            let app = PathBuf::from(app);
            if !app.is_absolute() {
                return Err("DESK_APP must be an absolute path to the desk's executable.".into());
            }
            Command::new(app)
        }
        None => installed(target)?,
    };
    command.arg(target);
    Ok(command)
}

#[cfg(target_os = "macos")]
fn installed(target: &str) -> Result<Command, String> {
    let mut command = Command::new("/usr/bin/open");
    if !desk_link::is_link(target) {
        command.args(["-a", "endue Desk"]);
    }
    Ok(command)
}

/// The per-user install (NSIS) first, then the per-machine one (MSI).
#[cfg(target_os = "windows")]
fn installed(_target: &str) -> Result<Command, String> {
    let under = |var: &str| {
        std::env::var_os(var).map(|base| {
            PathBuf::from(base)
                .join("endue Desk")
                .join("endue-desk.exe")
        })
    };
    let found = first_absolute(
        ["LOCALAPPDATA", "ProgramFiles"]
            .into_iter()
            .filter_map(under),
    );
    found
        .map(Command::new)
        .ok_or_else(|| "endue Desk is not installed where it looks; set DESK_APP to it.".into())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn installed(_target: &str) -> Result<Command, String> {
    let found =
        first_absolute(["/usr/bin/endue-desk", "/usr/local/bin/endue-desk"].map(PathBuf::from));
    found
        .map(Command::new)
        .ok_or_else(|| "endue Desk is not installed where it looks; set DESK_APP to it.".into())
}

/// `desk open <arg>`: 0 once the desk was started with it, 1 when it cannot be, or was refused.
pub fn run(arg: &str) -> ExitCode {
    let cwd = std::env::current_dir().unwrap_or_default();
    let target = match target(arg, &cwd) {
        Ok(target) => target,
        Err(why) => {
            eprintln!("desk: open: {why}");
            return ExitCode::from(1);
        }
    };
    let mut command = match command(&target) {
        Ok(command) => command,
        Err(why) => {
            eprintln!("desk: open: {why}");
            return ExitCode::from(1);
        }
    };
    // The desk keeps running when it is the first one: start it and leave it be.
    match command.spawn() {
        Ok(_) => ExitCode::SUCCESS,
        Err(why) => {
            eprintln!("desk: open: could not start endue Desk ({why})");
            ExitCode::from(1)
        }
    }
}
