//! Linux: an AppImage written beside the installed one and renamed over it, so the path always holds
//! a whole AppImage; a `.deb` installed with `pkexec dpkg -i`, which asks the person for the password
//! (ADR 0054). The running desk keeps the files it opened either way.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

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
    fs::write(&temp, bytes).map_err(|e| io_error("write to", dir, &e))?;
    let renamed = keep_mode(file, &temp).and_then(|()| fs::rename(&temp, file));
    if let Err(error) = renamed {
        let _ = fs::remove_file(&temp);
        return Err(io_error("replace", file, &error));
    }
    Ok(Relaunch::program(file.to_path_buf()))
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

/// Install the `.deb` in `bytes` (kept in `scratch` for dpkg) with the person's password; answers
/// `exe` to start again.
pub fn install_deb(
    exe: &Path,
    chosen: &Chosen,
    bytes: &[u8],
    scratch: &Path,
) -> Result<Relaunch, String> {
    if !(bytes.starts_with(b"!<arch>\n") && bytes.get(8..21) == Some(b"debian-binary")) {
        return Err(format!("the update for {} is not a .deb", chosen.target));
    }
    let package = package_path(scratch, chosen, "deb");
    write(&package, bytes)?;
    let (program, args) = deb_command(&package);
    let status = Command::new(&program)
        .args(&args)
        .status()
        .map_err(|e| format!("Desk could not run {program}: {e}"));
    let _ = fs::remove_file(&package);
    match status? {
        ok if ok.success() => Ok(Relaunch::program(exe.to_path_buf())),
        failed => Err(format!(
            "the package was not installed ({program} dpkg exited {})",
            failed
                .code()
                .map_or("on a signal".to_owned(), |c| c.to_string())
        )),
    }
}

/// The command that installs `package` as root, asking the person: `pkexec dpkg -i <package>`.
pub fn deb_command(package: &Path) -> (String, Vec<String>) {
    let package = package.to_string_lossy().into_owned();
    (
        "pkexec".to_owned(),
        vec!["dpkg".into(), "-i".into(), package],
    )
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
    use super::{deb_command, install_deb, package_path};
    use crate::status::Chosen;
    use std::path::Path;

    fn chosen() -> Chosen {
        Chosen {
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
        }
    }

    #[test]
    fn a_deb_goes_through_pkexec_dpkg_and_other_bytes_never_reach_it() {
        let (program, args) = deb_command(Path::new("/u/0.6.0/install.deb"));
        assert_eq!(program, "pkexec");
        assert_eq!(args, ["dpkg", "-i", "/u/0.6.0/install.deb"]);
        let scratch = std::env::temp_dir().join(format!("desk-deb-{}", std::process::id()));
        let exe = Path::new("/usr/lib/endue-desk/endue-desk");
        let why = install_deb(exe, &chosen(), b"\x7fELF", &scratch).unwrap_err();
        assert!(why.contains("is not a .deb"), "{why}");
        assert!(!package_path(&scratch, &chosen(), "deb").exists());
    }
}
