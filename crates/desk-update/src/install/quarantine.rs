//! macOS marks every file the CEF desk writes as quarantined (`LSFileQuarantineEnabled` in its
//! Info.plist, as in Chromium's, so the files a page downloads are). An update it unpacked would be
//! too, and Gatekeeper would hold the new app's first start for an answer from the person (with the
//! screen locked, for ever). The update was checked against the updater key before it was unpacked,
//! so its files lose the mark before the swap, and the swap is refused while the executable keeps it.

use std::path::Path;

/// The attribute macOS quarantines files with.
pub const ATTRIBUTE: &str = "com.apple.quarantine";

/// Take the quarantine mark off everything under `root`, links not followed; refused when
/// `executable` still carries it afterwards.
#[cfg(target_os = "macos")]
pub fn lift(root: &Path, executable: &Path) -> Result<(), String> {
    clear(root);
    match xattr::get(executable, ATTRIBUTE) {
        Ok(None) => Ok(()),
        Ok(Some(_)) => Err(format!(
            "the update stays quarantined: {} keeps {ATTRIBUTE}",
            executable.display()
        )),
        Err(e) => Err(format!("the update's quarantine cannot be read: {e}")),
    }
}

#[cfg(target_os = "macos")]
fn clear(path: &Path) {
    // Absent is the usual answer; a failure shows in the executable's check.
    let _ = xattr::remove(path, ATTRIBUTE);
    let folder = std::fs::symlink_metadata(path).is_ok_and(|m| m.is_dir());
    if folder && let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            clear(&entry.path());
        }
    }
}

/// Elsewhere nothing is quarantined.
#[cfg(not(target_os = "macos"))]
pub fn lift(_root: &Path, _executable: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::{ATTRIBUTE, lift};
    use std::fs;

    #[test]
    fn a_checked_update_loses_the_quarantine_mark_on_every_file() {
        let root = std::env::temp_dir().join(format!("desk-quarantine-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let macos = root.join("endue Desk.app/Contents/MacOS");
        fs::create_dir_all(&macos).unwrap();
        let program = macos.join("endue-desk-cef");
        fs::write(&program, b"desk").unwrap();
        let mark = b"0081;6af2cbd5;endue Desk;";
        for path in [&root, &macos, &program] {
            xattr::set(path, ATTRIBUTE, mark).unwrap();
        }
        lift(&root, &program).unwrap();
        for path in [&root, &macos, &program] {
            assert_eq!(
                xattr::get(path, ATTRIBUTE).unwrap(),
                None,
                "{}",
                path.display()
            );
        }
        let _ = fs::remove_dir_all(root);
    }
}
