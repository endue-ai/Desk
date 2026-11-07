//! `desk plugin list --lock`: `~/.desk/plugins.lock` as it is (ADR 0079), read from disk, so no desk
//! needs to run; `--json` prints the parsed document. `desk plugin sync` reads the same file.

use std::path::PathBuf;
use std::process::ExitCode;

use desk_bridge::PluginsLock;

/// The lock file of this HOME.
pub fn path() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|home| PathBuf::from(home).join(".desk/plugins.lock"))
}

/// The lock's text and its parsed document, or why there is none to read.
pub fn read() -> Result<(String, PluginsLock), String> {
    let path = path().ok_or("no HOME to find ~/.desk/plugins.lock in")?;
    let text = std::fs::read_to_string(&path)
        .map_err(|_| format!("no plugins.lock at {}", path.display()))?;
    let lock = desk_core::lock::parse(&text).map_err(|why| format!("{}: {why}", path.display()))?;
    Ok((text, lock))
}

pub fn list(json: bool) -> ExitCode {
    match read() {
        Ok((text, lock)) => {
            if json {
                println!("{}", serde_json::to_string(&lock).unwrap_or_default());
            } else {
                print!("{text}");
            }
            ExitCode::SUCCESS
        }
        Err(why) => {
            eprintln!("desk: {why}");
            ExitCode::from(1)
        }
    }
}
