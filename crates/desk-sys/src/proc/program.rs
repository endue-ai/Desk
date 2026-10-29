//! Finding the program before it starts, so a missing one is `not_found` in pipe and PTY mode alike.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::{Error, ErrorCode};

/// A program with a folder separator is a path (relative ones start from `cwd`); a bare name is looked
/// up on PATH, the spawn's own PATH if `env` sets one. Windows also tries each PATHEXT extension.
pub(super) fn resolve(
    program: &str,
    cwd: &Path,
    env: &BTreeMap<String, String>,
) -> Result<PathBuf, Error> {
    let not_found = || Error::new(ErrorCode::NotFound, format!("{program}: no such program"));
    if program.contains('/') || (cfg!(windows) && program.contains('\\')) {
        let path = cwd.join(program);
        if path.is_dir() {
            return Err(Error::new(
                ErrorCode::InvalidParams,
                format!("{program}: is a folder"),
            ));
        }
        return candidates(&path)
            .find(|c| c.is_file())
            .ok_or_else(not_found);
    }
    let path_var: Option<OsString> = match env.get("PATH") {
        Some(path) => Some(path.into()),
        None => std::env::var_os("PATH"),
    };
    let path_var = path_var.ok_or_else(not_found)?;
    std::env::split_paths(&path_var)
        .filter(|dir| !dir.as_os_str().is_empty())
        .flat_map(|dir| candidates(&dir.join(program)).collect::<Vec<_>>())
        .find(|candidate| runnable(candidate))
        .ok_or_else(not_found)
}

/// The file itself, then (Windows) the file with each PATHEXT extension.
fn candidates(path: &Path) -> impl Iterator<Item = PathBuf> {
    let mut list = vec![path.to_path_buf()];
    if cfg!(windows) {
        let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_owned());
        for ext in exts.split(';').filter(|e| !e.is_empty()) {
            let mut name = path.as_os_str().to_owned();
            name.push(ext);
            list.push(PathBuf::from(name));
        }
    }
    list.into_iter()
}

#[cfg(unix)]
fn runnable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt as _;
    std::fs::metadata(path)
        .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn runnable(path: &Path) -> bool {
    path.is_file()
}
