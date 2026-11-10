//! macOS: the `.app.tar.gz` unpacked beside the installed app, checked whole, then swapped with it in
//! one step (`swap::exchange`). The archive's top folder is the app, whatever its name, as Tauri's
//! updater reads it. The old app ends in the unpack folder, which goes once the swap is done.

use std::fs;
use std::path::{Path, PathBuf};

use flate2::read::GzDecoder;

use super::{Relaunch, beside, io_error, quarantine, swap};
use crate::status::Chosen;

/// Install the app in `bytes` in place of `app`; answers its executable to start again.
pub fn install(app: &Path, chosen: &Chosen, bytes: &[u8]) -> Result<Relaunch, String> {
    if !bytes.starts_with(&[0x1f, 0x8b]) {
        return Err(format!(
            "the update for {} is not an .app.tar.gz",
            chosen.target
        ));
    }
    let current = bundle_id(app);
    let folder =
        beside(app, &chosen.version).ok_or_else(|| format!("{} is not an app", app.display()))?;
    let _ = fs::remove_dir_all(&folder);
    fs::create_dir(&folder).map_err(|e| io_error("write to", parent(app), &e))?;
    let installed = unpack(bytes, &folder).and_then(|new| {
        let executable = check(&new, current.as_deref())?;
        quarantine::lift(&new, &new.join("Contents/MacOS").join(&executable))?;
        swap::exchange(app, &new, &folder.join("previous.app"))
            .map_err(|e| io_error("replace", app, &e))?;
        Ok(executable)
    });
    // The unpack folder holds the old app now, or what failed to become the new one.
    let _ = fs::remove_dir_all(&folder);
    let executable = installed?;
    // A new modification time makes Launch Services read the new Info.plist.
    let _ = fs::File::open(app).and_then(|dir| dir.set_modified(std::time::SystemTime::now()));
    Ok(Relaunch::program(
        app.join("Contents/MacOS").join(executable),
    ))
}

fn parent(app: &Path) -> &Path {
    app.parent().unwrap_or(app)
}

/// Unpack `bytes` into `folder`; answers the one app it holds.
fn unpack(bytes: &[u8], folder: &Path) -> Result<PathBuf, String> {
    let mut archive = tar::Archive::new(GzDecoder::new(bytes));
    archive.set_preserve_permissions(true);
    archive.set_preserve_mtime(true);
    archive.set_unpack_xattrs(false);
    // `unpack` keeps every entry inside `folder` (no absolute paths, no `..`).
    archive
        .unpack(folder)
        .map_err(|e| format!("the update did not unpack: {e}"))?;
    let apps: Vec<PathBuf> = fs::read_dir(folder)
        .map_err(|e| format!("the unpacked update cannot be read: {e}"))?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "app") && path.is_dir())
        .collect();
    match apps.as_slice() {
        [app] => Ok(app.clone()),
        [] => Err("the update holds no app".to_owned()),
        _ => Err("the update holds more than one app".to_owned()),
    }
}

/// The new app's executable, once its Info.plist names one that is there and runs, and its identifier
/// is the installed app's.
fn check(new: &Path, current: Option<&str>) -> Result<String, String> {
    let info = info(new).map_err(|e| format!("the update's app has no Info.plist ({e})"))?;
    let executable = info
        .get("CFBundleExecutable")
        .and_then(plist::Value::as_string)
        .ok_or("the update's Info.plist names no executable")?
        .to_owned();
    let id = info
        .get("CFBundleIdentifier")
        .and_then(plist::Value::as_string);
    if let (Some(current), Some(id)) = (current, id)
        && current != id
    {
        return Err(format!("the update is {id}, not this desk ({current})"));
    }
    let program = new.join("Contents/MacOS").join(&executable);
    if !runs(&program) {
        return Err(format!("the update's app has no executable {executable}"));
    }
    Ok(executable)
}

fn info(app: &Path) -> Result<plist::Dictionary, String> {
    let value =
        plist::Value::from_file(app.join("Contents/Info.plist")).map_err(|e| e.to_string())?;
    value
        .into_dictionary()
        .ok_or_else(|| "not a dictionary".to_owned())
}

/// The installed app's identifier, when its Info.plist reads.
fn bundle_id(app: &Path) -> Option<String> {
    info(app)
        .ok()?
        .get("CFBundleIdentifier")
        .and_then(plist::Value::as_string)
        .map(str::to_owned)
}

#[cfg(unix)]
fn runs(program: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(program).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn runs(program: &Path) -> bool {
    program.is_file()
}
