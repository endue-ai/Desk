//! Exchanging two paths, so the installed one never goes missing: in one step with macOS's
//! `renamex_np(RENAME_SWAP)` on APFS, else with two renames and the first undone when the second fails.

use std::io;
use std::path::Path;

/// Exchange `installed` and `new`: afterwards `installed` holds what `new` held and the reverse.
/// A permission error is returned as it is, with nothing moved.
pub fn exchange(installed: &Path, new: &Path, spare: &Path) -> io::Result<()> {
    match swap(installed, new) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => Err(error),
        // The file system cannot swap (HFS+, other OSes): move instead.
        Err(_) => replace(installed, new, spare),
    }
}

/// Move `installed` to `spare`, then `new` to `installed`; put `installed` back when the second fails.
/// Afterwards `new` holds what `installed` held, as after a swap.
fn replace(installed: &Path, new: &Path, spare: &Path) -> io::Result<()> {
    std::fs::rename(installed, spare)?;
    if let Err(error) = std::fs::rename(new, installed) {
        let _ = std::fs::rename(spare, installed);
        return Err(error);
    }
    std::fs::rename(spare, new)
}

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
fn swap(installed: &Path, new: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let from = CString::new(new.as_os_str().as_bytes())?;
    let to = CString::new(installed.as_os_str().as_bytes())?;
    // SAFETY: both pointers are NUL-terminated strings that outlive the call, which only reads them.
    let done = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_SWAP) };
    if done == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(target_os = "macos"))]
fn swap(_installed: &Path, _new: &Path) -> io::Result<()> {
    Err(io::Error::from(io::ErrorKind::Unsupported))
}

#[cfg(test)]
mod tests {
    use super::{exchange, replace};
    use std::fs;

    fn dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("desk-swap-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn exchange_and_replace_leave_the_two_folders_swapped() {
        let root = dir("both");
        for (n, run) in [exchange, replace].into_iter().enumerate() {
            let (a, b) = (root.join(format!("a{n}")), root.join(format!("b{n}")));
            fs::create_dir_all(&a).unwrap();
            fs::create_dir_all(&b).unwrap();
            fs::write(a.join("which"), "old").unwrap();
            fs::write(b.join("which"), "new").unwrap();
            run(&a, &b, &root.join(format!("spare{n}"))).unwrap();
            assert_eq!(fs::read_to_string(a.join("which")).unwrap(), "new");
            assert_eq!(fs::read_to_string(b.join("which")).unwrap(), "old");
            assert!(!root.join(format!("spare{n}")).exists());
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_failed_move_puts_the_installed_folder_back() {
        let root = dir("undo");
        let a = root.join("a");
        fs::create_dir_all(&a).unwrap();
        fs::write(a.join("which"), "old").unwrap();
        assert!(replace(&a, &root.join("missing"), &root.join("spare")).is_err());
        assert_eq!(fs::read_to_string(a.join("which")).unwrap(), "old");
        let _ = fs::remove_dir_all(root);
    }
}
