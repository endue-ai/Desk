//! Where the shell finds its files and keeps its data.

use std::path::{Path, PathBuf};

/// The app identifier: the data folder's name, the same as the Tauri shell's (`tauri.conf.json`).
pub const IDENTIFIER: &str = "ai.endue.desk";

/// The page the main window opens unless `DESK_SHELL_URL` names another.
pub const START_URL: &str = "desk-app://app/index.html";

/// The built web runtime the `desk-app` scheme serves: `DESK_SHELL_DIST`, else the bundle's copy
/// (`Contents/Resources/shell` on macOS, `shell/` beside the binary elsewhere), else the repository's
/// `apps/desk/dist` for development builds.
pub fn dist() -> PathBuf {
    if let Some(dir) = std::env::var_os("DESK_SHELL_DIST") {
        return PathBuf::from(dir);
    }
    if let Some(dir) = bundled(&std::env::current_exe().unwrap_or_default()) {
        return dir;
    }
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist")
}

/// The shell's files inside a bundle around `exe`, when they are there.
fn bundled(exe: &Path) -> Option<PathBuf> {
    let dir = exe.parent()?;
    let candidate = if cfg!(target_os = "macos") {
        dir.parent()?.join("Resources").join("shell")
    } else {
        dir.join("shell")
    };
    candidate.join("index.html").is_file().then_some(candidate)
}

/// The URL the main window opens.
pub fn start_url() -> String {
    std::env::var("DESK_SHELL_URL").unwrap_or_else(|_| START_URL.to_owned())
}

/// The per-user data folder, as Tauri's `app_data_dir`: Application Support on macOS, the roaming
/// AppData on Windows, `$XDG_DATA_HOME` (else `~/.local/share`) on Linux.
pub fn data_dir() -> PathBuf {
    let home = home_dir();
    let base = if cfg!(target_os = "macos") {
        home.join("Library").join("Application Support")
    } else if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Roaming"))
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local").join("share"))
    };
    base.join(IDENTIFIER)
}

/// CEF's cache and profile root, inside the data folder.
pub fn cef_root() -> PathBuf {
    data_dir().join("cef")
}

/// The person's home folder.
pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}

#[cfg(test)]
mod tests {
    use super::{IDENTIFIER, bundled, data_dir};
    use std::fs;

    #[test]
    fn the_data_folder_is_named_after_the_identifier() {
        assert!(data_dir().ends_with(IDENTIFIER));
    }

    #[test]
    fn a_bundle_is_used_only_when_it_holds_the_shell() {
        let dir = tempfile_dir();
        let exe = if cfg!(target_os = "macos") {
            dir.join("Desk.app/Contents/MacOS/endue-desk-cef")
        } else {
            dir.join("endue-desk-cef")
        };
        fs::create_dir_all(exe.parent().unwrap()).unwrap();
        assert_eq!(bundled(&exe), None);
        let shell = if cfg!(target_os = "macos") {
            dir.join("Desk.app/Contents/Resources/shell")
        } else {
            dir.join("shell")
        };
        fs::create_dir_all(&shell).unwrap();
        fs::write(shell.join("index.html"), "<!doctype html>").unwrap();
        assert_eq!(bundled(&exe), Some(shell));
        let _ = fs::remove_dir_all(dir);
    }

    fn tempfile_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("desk-shell-paths-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }
}
