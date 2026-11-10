//! Installing a verified build without `tauri-plugin-updater` (feature `install`, ADR 0147): how a
//! desk is installed (`Layout`), what an update puts in its place, and what starts it again
//! (`Relaunch`). macOS swaps the `.app` for the one in the `.app.tar.gz` in one step; an AppImage is
//! rewritten beside itself and renamed over; a `.deb` goes through `pkexec dpkg -i`; on Windows the
//! NSIS or MSI installer runs silently once the desk has quit, then starts it again. The artifacts are
//! the ones Tauri's updater reads, so one release serves a Tauri desk and a CEF desk.
//!
//! Every step checks before it changes anything: the bytes are the package the layout takes, the
//! folder can be written, the new app is whole. A failed install leaves the running desk as it was.

mod app;
mod file;
mod quarantine;
mod relaunch;
mod swap;
mod windows;

use std::path::{Path, PathBuf};

use crate::ports::Installer;
use crate::status::Chosen;

pub use relaunch::Relaunch;

/// How the running desk is installed: what an update replaces and starts again.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Layout {
    /// A macOS app bundle (`…/endue Desk.app`).
    App { app: PathBuf },
    /// An AppImage (`$APPIMAGE`).
    AppImage { file: PathBuf },
    /// A Debian package; `exe` starts the desk again.
    Deb { exe: PathBuf },
    /// An NSIS install: `exe` with `uninstall.exe` beside it.
    Nsis { exe: PathBuf },
    /// An MSI install under Program Files.
    Msi { exe: PathBuf },
}

/// What [`Layout::of`] reads about the running desk.
#[derive(Debug, Clone)]
pub struct Running<'a> {
    /// `std::env::current_exe()`.
    pub exe: &'a Path,
    /// `$APPIMAGE`, which the AppImage runtime sets.
    pub appimage: Option<&'a Path>,
    /// `%ProgramFiles%` on Windows, where an MSI installs.
    pub program_files: Option<&'a Path>,
}

impl<'a> Running<'a> {
    /// The desk at `exe`, outside an AppImage and without Program Files.
    pub fn at(exe: &'a Path) -> Self {
        Self {
            exe,
            appimage: None,
            program_files: None,
        }
    }
}

impl Layout {
    /// How the desk running from `running.exe` is installed on `os` (`macos`, `linux`, `windows`):
    /// none for a development build, which an update cannot replace.
    pub fn of(os: &str, running: &Running) -> Option<Self> {
        let exe = running.exe.to_path_buf();
        match os {
            "macos" => {
                let macos = exe.parent()?;
                let contents = macos.parent()?;
                let app = contents.parent()?;
                let bundled = macos.file_name()? == "MacOS"
                    && contents.file_name()? == "Contents"
                    && app.extension()? == "app";
                bundled.then(|| Self::App {
                    app: app.to_path_buf(),
                })
            }
            "linux" => match running.appimage {
                Some(file) => Some(Self::AppImage {
                    file: file.to_path_buf(),
                }),
                None => exe.starts_with("/usr/lib").then_some(Self::Deb { exe }),
            },
            "windows" => {
                let dir = exe.parent()?;
                if dir.join("uninstall.exe").is_file() {
                    Some(Self::Nsis { exe })
                } else if running.program_files.is_some_and(|pf| exe.starts_with(pf)) {
                    Some(Self::Msi { exe })
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    /// The release targets this desk updates as, most specific first, for `base` (`darwin-aarch64`).
    /// A `.deb` or an MSI never falls back to the plain target, which names another package.
    pub fn targets(&self, base: &str) -> Vec<String> {
        let (kind, plain) = match self {
            Self::App { .. } => ("app", true),
            Self::AppImage { .. } => ("appimage", true),
            Self::Deb { .. } => ("deb", false),
            Self::Nsis { .. } => ("nsis", true),
            Self::Msi { .. } => ("msi", false),
        };
        let mut targets = vec![format!("{base}-{kind}")];
        if plain {
            targets.push(base.to_owned());
        }
        targets
    }
}

/// This machine's release target without the package: `darwin-aarch64`, `windows-x86_64`.
pub fn base_target() -> Option<String> {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "windows",
        "linux" => "linux",
        _ => return None,
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "aarch64",
        "x86_64" => "x86_64",
        _ => return None,
    };
    Some(format!("{os}-{arch}"))
}

/// Put `bytes`, the verified artifact of `chosen`, in place of the desk installed as `layout`, using
/// `scratch` (the updates folder) for files the OS installer reads. Answers what starts the desk again
/// once it has quit. On Windows nothing changes until then: the installer waits for the desk to end.
pub fn install(
    layout: &Layout,
    chosen: &Chosen,
    bytes: &[u8],
    scratch: &Path,
) -> Result<Relaunch, String> {
    match layout {
        Layout::App { app } => app::install(app, chosen, bytes),
        Layout::AppImage { file } => file::install_appimage(file, chosen, bytes),
        Layout::Deb { exe } => file::install_deb(exe, chosen, bytes, scratch),
        Layout::Nsis { exe } => windows::stage(exe, windows::Kind::Nsis, chosen, bytes, scratch),
        Layout::Msi { exe } => windows::stage(exe, windows::Kind::Msi, chosen, bytes, scratch),
    }
}

/// The app's restart: told what starts the desk again, it quits the desk and starts that once it has.
pub type Restart = Box<dyn Fn(Relaunch) -> Result<(), String> + Send + Sync>;

/// The `Installer` a desk without Tauri supplies: [`install`] into its layout, then its restart.
pub struct PackageInstaller {
    layout: Layout,
    scratch: PathBuf,
    restart: Restart,
}

impl PackageInstaller {
    pub fn new(layout: Layout, scratch: impl Into<PathBuf>, restart: Restart) -> Self {
        Self {
            layout,
            scratch: scratch.into(),
            restart,
        }
    }

    pub fn layout(&self) -> &Layout {
        &self.layout
    }
}

impl Installer for PackageInstaller {
    fn install(&self, chosen: &Chosen, bytes: &[u8]) -> Result<(), String> {
        let relaunch = install(&self.layout, chosen, bytes, &self.scratch)?;
        (self.restart)(relaunch)
    }
}

/// `what` failed at `path`, in words that say when it is the folder's permissions.
fn io_error(what: &str, path: &Path, error: &std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        format!(
            "Desk has no permission to {what} {}: install the update by hand",
            path.display()
        )
    } else {
        format!("Desk could not {what} {}: {error}", path.display())
    }
}

/// A file beside `path` that an update writes first, then renames over or swaps with it.
fn beside(path: &Path, version: &str) -> Option<PathBuf> {
    let name = path.file_name()?.to_string_lossy();
    Some(path.with_file_name(format!(".{name}.{version}.update")))
}
