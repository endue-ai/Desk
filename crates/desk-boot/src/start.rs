//! How this start goes (ADR 0061). `--safe` or `DESK_SAFE=1` asks for safe mode; last-start.json
//! says whether the starts before this one keep dying, in which case safe mode comes on by itself.
//! The shell's `desk_start` hands the runtime what the start found ([`Start::info`]: safe mode, the
//! state files kept broken), and `desk_relaunch` starts the desk again without safe mode
//! ([`relaunch`], "Start normally"). A clean quit marks the record ([`Start::quit`]); the next start
//! names a run that was not marked (ADR 0187).

use std::ffi::OsString;
use std::path::Path;
use std::sync::Mutex;
use std::time::SystemTime;

use desk_core::{Core, LastStart, SafeReason};

use crate::crash::Crash;
use serde_json::{Value, json};

/// The flag that asks for safe mode, and the environment variable that does the same.
pub const SAFE_FLAG: &str = "--safe";
pub const SAFE_ENV: &str = "DESK_SAFE";

/// This start: its record in last-start.json and what the runtime is told about it.
pub struct Start {
    last: Mutex<LastStart>,
    info: Value,
}

/// Whether the person asked for safe mode: `--safe` among `args`, or `DESK_SAFE=1`.
pub fn asked(mut args: impl Iterator<Item = OsString>, env: Option<OsString>) -> bool {
    args.any(|arg| arg == SAFE_FLAG) || env.is_some_and(|value| value == "1")
}

/// Write this start to last-start.json and decide whether it runs in safe mode, before the core
/// installs any plugin. A broken last-start.json is reported to the core like its own files; a run
/// before this one that ended without quitting gets its report.
pub fn begin(data: &Path, core: Core, crash: &Crash) -> (Core, LastStart) {
    let (last, begun) = LastStart::begin(
        &data.join("last-start.json"),
        SystemTime::now(),
        std::process::id(),
    );
    let reason = if asked(std::env::args_os().skip(1), std::env::var_os(SAFE_ENV)) {
        Some(SafeReason::Asked)
    } else if begun.crash_loop {
        Some(SafeReason::CrashLoop)
    } else {
        None
    };
    if let Some(file) = begun.broken {
        core.report_broken(file);
    }
    if let Some(run) = &begun.unclean {
        crash.ended_unclean(run);
    }
    match reason {
        Some(reason) => {
            eprintln!("endue Desk: safe mode ({reason:?}): only the desk.* policy plugins run");
            (core.with_safe_mode(reason), last)
        }
        None => (core, last),
    }
}

impl Start {
    /// What the runtime is told, once the plugins are installed (so safe mode knows what it held).
    pub fn new(core: &Core, data: &Path, last: LastStart) -> Self {
        let broken: Vec<Value> = core
            .broken_files()
            .into_iter()
            .map(|file| json!({ "name": file.name, "path": file.kept.display().to_string() }))
            .collect();
        let mut info = json!({ "broken": broken, "dataDir": data.display().to_string() });
        if let Some(safe) = core.safe_mode() {
            let reason = match safe.reason {
                SafeReason::Asked => "asked",
                SafeReason::CrashLoop => "crash-loop",
            };
            info["safe"] = json!({ "reason": reason, "heldOff": safe.held_off });
        }
        Self {
            last: Mutex::new(last),
            info,
        }
    }

    /// The ready line: this start made it (within 60 s, or late).
    pub fn ready(&self) {
        let last = self
            .last
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        last.ready(SystemTime::now());
    }

    /// A clean quit: the next start has nothing to say about this run.
    pub fn quit(&self) {
        let last = self
            .last
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        last.quit();
    }
}

impl Start {
    /// What this start found: `{ safe?: { reason, heldOff }, broken: [{ name, path }], dataDir }`.
    pub fn info(&self) -> Value {
        self.info.clone()
    }
}

/// Start the desk again without `--safe` and without `DESK_SAFE`, then quit. `release` lets the shell
/// give up what the new process needs first (its single-instance lock), or the new process would
/// hand its arguments to this one and quit itself.
pub fn relaunch(release: impl FnOnce()) {
    relaunch_with(release, &[]);
}

/// [`relaunch`], the new desk hearing `env` as well (a start for a stall says when it was, ADR 0202).
pub fn relaunch_with(release: impl FnOnce(), env: &[(&str, String)]) {
    let Ok(binary) = std::env::current_exe() else {
        eprintln!("endue Desk: cannot find its own binary to start again");
        return;
    };
    let args: Vec<OsString> = std::env::args_os()
        .skip(1)
        .filter(|arg| arg != SAFE_FLAG)
        .collect();
    release();
    let started = std::process::Command::new(binary)
        .args(args)
        .env_remove(SAFE_ENV)
        .envs(env.iter().map(|(key, value)| (key, value)))
        .spawn();
    if let Err(why) = started {
        eprintln!("endue Desk: could not start again ({why})");
    }
    std::process::exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(words: &[&str]) -> impl Iterator<Item = OsString> {
        words
            .iter()
            .map(OsString::from)
            .collect::<Vec<_>>()
            .into_iter()
    }

    #[test]
    fn safe_mode_is_asked_by_flag_or_environment() {
        assert!(asked(args(&["--safe"]), None));
        assert!(asked(args(&["/tmp/a.md", "--safe"]), None));
        assert!(asked(args(&[]), Some(OsString::from("1"))));
        assert!(!asked(args(&["/tmp/a.md"]), None));
        assert!(!asked(args(&[]), Some(OsString::from("0"))));
        assert!(!asked(args(&["--safer"]), Some(OsString::new())));
    }
}
