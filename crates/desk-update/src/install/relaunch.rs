//! What starts the desk again after an update, once the old one has let go of what one desk holds
//! (its single-instance lock, its socket, Chromium's profile). It starts detached: in a process group
//! of its own, its output in a file of the updates folder, so a closed terminal or the old desk's end
//! never takes it down.

use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

/// A program and its arguments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Relaunch {
    pub program: PathBuf,
    pub args: Vec<String>,
}

impl Relaunch {
    pub fn new(program: PathBuf, args: Vec<String>) -> Self {
        Self { program, args }
    }

    /// `program` without arguments: the desk starts as it does from the Dock or the menu.
    pub fn program(program: PathBuf) -> Self {
        Self::new(program, Vec::new())
    }

    /// Start it, detached, with this process's environment; its output goes to `log` when given.
    pub fn spawn(&self, log: Option<&Path>) -> io::Result<Child> {
        let mut command = Command::new(&self.program);
        command.args(&self.args).stdin(Stdio::null());
        match log.map(File::create).transpose()? {
            Some(file) => {
                command.stdout(file.try_clone()?).stderr(file);
            }
            None => {
                command.stdout(Stdio::null()).stderr(Stdio::null());
            }
        }
        detach(&mut command);
        command.spawn()
    }
}

#[cfg(unix)]
fn detach(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(windows)]
fn detach(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
}

#[cfg(not(any(unix, windows)))]
fn detach(_command: &mut Command) {}
