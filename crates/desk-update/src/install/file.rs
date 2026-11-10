//! Linux: an AppImage written beside the installed one and renamed over it, so the path always holds
//! a whole AppImage; a `.deb` installed with `dpkg -i` behind `pkexec`, which asks the person for the
//! password (ADR 0054, ADR 0163). The running desk keeps the files it opened either way. An AppImage
//! the desk may not replace is never elevated: the reason says how to update it by hand (#99).

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use super::elevate::{Elevate, Refusal, Step, declined};
use super::{Relaunch, beside, io_error};
use crate::status::Chosen;

/// Replace the AppImage `file` with `bytes`; answers it to start again.
pub fn install_appimage(file: &Path, chosen: &Chosen, bytes: &[u8]) -> Result<Relaunch, String> {
    if !bytes.starts_with(b"\x7fELF") {
        return Err(format!(
            "the update for {} is not an AppImage",
            chosen.target
        ));
    }
    let temp = beside(file, &chosen.version)
        .ok_or_else(|| format!("{} is not an AppImage", file.display()))?;
    let dir = file.parent().unwrap_or(file);
    fs::write(&temp, bytes).map_err(|e| appimage_error("write to", dir, file, chosen, &e))?;
    let renamed = keep_mode(file, &temp).and_then(|()| fs::rename(&temp, file));
    if let Err(error) = renamed {
        let _ = fs::remove_file(&temp);
        return Err(appimage_error("replace", file, file, chosen, &error));
    }
    Ok(Relaunch::program(file.to_path_buf()))
}

/// `what` failed at `path`; when the place is read-only, how the person updates `file` by hand.
fn appimage_error(
    what: &str,
    path: &Path,
    file: &Path,
    chosen: &Chosen,
    error: &std::io::Error,
) -> String {
    let said = io_error(what, path, error);
    match error.kind() {
        ErrorKind::PermissionDenied | ErrorKind::ReadOnlyFilesystem => format!(
            "{said}. To update by hand, download {} and put it in place of {}, or move the AppImage to a folder you can write, such as ~/Applications, and start it from there",
            chosen.url,
            file.display()
        ),
        _ => said,
    }
}

/// Give `temp` the installed file's permissions, at least executable by its owner.
#[cfg(unix)]
fn keep_mode(file: &Path, temp: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mode = fs::metadata(file).map_or(0o755, |m| m.permissions().mode()) | 0o700;
    fs::set_permissions(temp, fs::Permissions::from_mode(mode & 0o7777))
}

#[cfg(not(unix))]
fn keep_mode(_file: &Path, _temp: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Install the `.deb` in `bytes` (kept in `scratch` for dpkg) through `elevate`, which asks the
/// person once; answers `exe` to start again.
pub fn install_deb(
    exe: &Path,
    chosen: &Chosen,
    bytes: &[u8],
    scratch: &Path,
    elevate: &dyn Elevate,
) -> Result<Relaunch, String> {
    if !(bytes.starts_with(b"!<arch>\n") && bytes.get(8..21) == Some(b"debian-binary")) {
        return Err(format!("the update for {} is not a .deb", chosen.target));
    }
    let package = package_path(scratch, chosen, "deb");
    write(&package, bytes)?;
    let ran = elevate.run(&deb_step(&package, chosen));
    let _ = fs::remove_file(&package);
    match ran {
        Ok(()) => Ok(Relaunch::program(exe.to_path_buf())),
        Err(Refusal::Declined) => Err(declined("install the package")),
        Err(Refusal::Failed(said)) => Err(format!(
            "the package was not installed ({said}). To install it by hand, download {} and run sudo dpkg -i on it",
            chosen.url
        )),
    }
}

/// The step that installs `package` as root: `dpkg -i <package>`.
pub fn deb_step(package: &Path, chosen: &Chosen) -> Step {
    Step {
        why: format!(
            "endue Desk wants to install its update to {}.",
            chosen.version
        ),
        program: "dpkg".to_owned(),
        args: vec!["-i".to_owned(), package.to_string_lossy().into_owned()],
    }
}

/// Where an installer package for `chosen` is kept: `<scratch>/<version>/install.<ext>`.
pub fn package_path(scratch: &Path, chosen: &Chosen, ext: &str) -> PathBuf {
    scratch.join(&chosen.version).join(format!("install.{ext}"))
}

/// Write `bytes` to `path`, its folder made first.
pub fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().unwrap_or(path);
    fs::create_dir_all(dir)
        .and_then(|()| fs::write(path, bytes))
        .map_err(|e| io_error("write to", dir, &e))
}

#[cfg(test)]
mod tests {
    use super::{deb_step, package_path};
    use crate::status::Chosen;
    use std::path::Path;

    #[test]
    fn a_deb_is_installed_by_dpkg_as_root() {
        let chosen = Chosen {
            version: "0.6.0".to_owned(),
            commit: None,
            date: None,
            notes: None,
            target: "linux-x86_64-deb".to_owned(),
            url: "https://releases.example.test/desk/releases/0.6.0/d.deb".to_owned(),
            file: "d.deb".to_owned(),
            size: 4,
            sha256: String::new(),
            signature: String::new(),
            release: String::new(),
        };
        let package = package_path(Path::new("/u"), &chosen, "deb");
        assert_eq!(package, Path::new("/u/0.6.0/install.deb"));
        let step = deb_step(&package, &chosen);
        assert_eq!(step.program, "dpkg");
        assert_eq!(step.args, ["-i", "/u/0.6.0/install.deb"]);
    }
}
