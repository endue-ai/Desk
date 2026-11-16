//! `desk open <path|link>` (#310): hand a file or an `endue://` link to the running desk, or start
//! the desk with it. A path is made absolute against the folder `desk` runs in; a link is checked
//! against the v1 grammar first (`desk-link`), and one the desk would refuse starts nothing. The desk
//! itself takes it from there: a second start hands its argument to the running desk and quits
//! (`apps/desk/shell/src/instance.rs`); on macOS `open` hands it over as the OS does from Finder.
//! `DESK_APP` names the desk's executable instead of the installed one.

use std::path::Path;
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

/// How the desk is started with `target`.
fn command(target: &str) -> Command {
    if let Some(app) = std::env::var_os("DESK_APP").filter(|app| !app.is_empty()) {
        let mut command = Command::new(app);
        command.arg(target);
        return command;
    }
    installed(target)
}

#[cfg(target_os = "macos")]
fn installed(target: &str) -> Command {
    let mut command = Command::new("/usr/bin/open");
    if !desk_link::is_link(target) {
        command.args(["-a", "endue Desk"]);
    }
    command.arg(target);
    command
}

#[cfg(target_os = "windows")]
fn installed(target: &str) -> Command {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_default();
    let mut command = Command::new(base.join("endue Desk").join("endue-desk.exe"));
    command.arg(target);
    command
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn installed(target: &str) -> Command {
    let mut command = Command::new("endue-desk");
    command.arg(target);
    command
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
    // The desk keeps running when it is the first one: start it and leave it be.
    match command(&target).spawn() {
        Ok(_) => ExitCode::SUCCESS,
        Err(why) => {
            eprintln!("desk: open: could not start endue Desk ({why})");
            ExitCode::from(1)
        }
    }
}
