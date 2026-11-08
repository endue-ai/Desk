//! Moving one path, for fs.rename and the undo and redo of a rename: the OS's rename on one volume,
//! which never overwrites (desk-sys); across volumes, a copy and then the source to the trash, so the
//! bytes are in one place or the other whatever fails.

use std::io;
use std::path::Path;

use desk_bridge::BridgeError;
use desk_sys::fs as sysfs;

use crate::handler::{Core, sys_error};

impl Core {
    /// Move `from` to `to`: whether it crossed volumes (copied, then trashed).
    pub(crate) fn move_path(&self, from: &Path, to: &Path) -> Result<bool, BridgeError> {
        move_path(from, to, &|path| self.trash_path(path))
    }
}

/// A primitive's `io::Error` on the bridge, with its code (`already_exists`, `not_found`, ...).
pub(crate) fn sys(err: io::Error) -> BridgeError {
    sys_error(desk_sys::Error::from(err))
}

fn move_path(from: &Path, to: &Path, trash: &Trash<'_>) -> Result<bool, BridgeError> {
    match sysfs::rename(from, to) {
        Ok(()) => Ok(false),
        Err(err) if err.kind() == io::ErrorKind::CrossesDevices => {
            move_across(from, to, trash).map(|()| true)
        }
        Err(err) => Err(sys(err)),
    }
}

type Trash<'a> = dyn Fn(&Path) -> Result<(), BridgeError> + 'a;

/// Across volumes: copy `from` to `to` as fs.copy does (never over an entry), then move `from` to
/// the trash. When the trash refuses, the copy this call made is removed again, `from` still holds
/// every byte, and the trash's error is the answer.
fn move_across(from: &Path, to: &Path, trash: &Trash<'_>) -> Result<(), BridgeError> {
    sysfs::copy(from, to).map_err(sys)?;
    if let Err(refused) = trash(from) {
        remove_copy(to);
        return Err(refused);
    }
    Ok(())
}

/// Remove the copy a refused move made, best effort. Its folders are made writable first, since a
/// copy keeps the source's permissions.
fn remove_copy(path: &Path) {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return;
    };
    if meta.is_dir() {
        make_writable(path);
        let _ = std::fs::remove_dir_all(path);
    } else {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(unix)]
fn make_writable(dir: &Path) {
    use std::os::unix::fs::PermissionsExt as _;
    let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            make_writable(&entry.path());
        }
    }
}

#[cfg(not(unix))]
fn make_writable(_dir: &Path) {}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use desk_bridge::ErrorCode;

    use super::*;
    use crate::handler::error;

    fn temp(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("desk-moves-{tag}-{nanos}"));
        fs::create_dir_all(dir.join("from/inner")).unwrap();
        fs::write(dir.join("from/inner/a.txt"), "alpha").unwrap();
        dir
    }

    #[test]
    fn a_move_on_one_volume_is_a_rename() {
        let dir = temp("same");
        let never = |_: &Path| -> Result<(), BridgeError> { panic!("no trash on one volume") };
        let crossed = move_path(&dir.join("from"), &dir.join("to"), &never).unwrap();
        assert!(!crossed);
        assert_eq!(
            fs::read_to_string(dir.join("to/inner/a.txt")).unwrap(),
            "alpha"
        );
        assert!(!dir.join("from").exists());
    }

    #[test]
    fn across_volumes_it_copies_then_trashes_the_source() {
        let dir = temp("across");
        let bin = dir.join("bin");
        let trash = |path: &Path| {
            fs::rename(path, &bin).map_err(sys)?;
            Ok(())
        };
        move_across(&dir.join("from"), &dir.join("to"), &trash).unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("to/inner/a.txt")).unwrap(),
            "alpha"
        );
        assert_eq!(
            fs::read_to_string(bin.join("inner/a.txt")).unwrap(),
            "alpha"
        );
        assert!(!dir.join("from").exists());
    }

    #[test]
    fn a_refused_trash_takes_the_copy_back_and_keeps_the_source() {
        let dir = temp("refused");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let locked = fs::Permissions::from_mode(0o555);
            fs::set_permissions(dir.join("from/inner"), locked).unwrap();
        }
        let refuse = |_: &Path| Err(error(ErrorCode::Unsupported, "no trash here".to_owned()));
        let refused = move_across(&dir.join("from"), &dir.join("to"), &refuse).unwrap_err();
        assert_eq!(refused.code, ErrorCode::Unsupported);
        assert!(!dir.join("to").exists(), "the copy is taken back");
        assert_eq!(
            fs::read_to_string(dir.join("from/inner/a.txt")).unwrap(),
            "alpha"
        );
        // An entry already at `to` is never copied over.
        fs::write(dir.join("taken"), "mine").unwrap();
        let never = |_: &Path| -> Result<(), BridgeError> { panic!("nothing was copied") };
        let taken = move_across(&dir.join("from"), &dir.join("taken"), &never).unwrap_err();
        assert_eq!(taken.code, ErrorCode::AlreadyExists);
        assert_eq!(fs::read_to_string(dir.join("taken")).unwrap(), "mine");
    }
}
