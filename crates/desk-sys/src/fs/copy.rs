//! `copy`: a file, a folder tree or a link, built under a hidden temp name beside the target and
//! renamed into place once complete, so the target never appears half copied.

use std::fs::{File, Metadata, OpenOptions, Permissions};
use std::io;
use std::path::{Path, PathBuf};

use super::ops::{entry_at, parent_of, refuse, refuse_into_itself};
use super::{temp_name, with_path};

/// Folders a copy created, outermost first, with the permissions each gets once the tree is in place.
type Folders = Vec<(PathBuf, Permissions)>;

/// Copy `from` to `to` and return the bytes of the files copied. A folder is copied with everything
/// in it; a link, at the top or inside a folder, is made again with the same target text, never
/// followed. Files keep their permissions, folders get theirs after their contents; times are not
/// kept. Never overwrites: an entry at `to` is `AlreadyExists`. A folder copied into itself, and a
/// FIFO, socket or device file anywhere, are `InvalidInput`. The copy is built at
/// `.<name>.desk-<pid>-<n>.tmp` beside `to` and renamed to `to` when complete; when it fails, the
/// temp entry is removed and nothing is left behind.
pub fn copy(from: &Path, to: &Path) -> io::Result<u64> {
    let meta = std::fs::symlink_metadata(from).map_err(|err| with_path(err, from))?;
    let Some(name) = to.file_name() else {
        return Err(refuse(io::ErrorKind::InvalidInput, to, "not a file path"));
    };
    if entry_at(to)?.is_some() {
        return Err(refuse(io::ErrorKind::AlreadyExists, to, "already exists"));
    }
    let parent = parent_of(to);
    match std::fs::metadata(parent) {
        Ok(folder) if folder.is_dir() => {}
        Ok(_) => return Err(refuse(io::ErrorKind::NotADirectory, parent, "not a folder")),
        Err(err) => return Err(with_path(err, parent)),
    }
    if meta.is_dir() {
        refuse_into_itself(from, to)?;
    }

    let temp = parent.join(temp_name(name));
    let bytes = make(from, &meta, &temp)?;
    let mut folders = Folders::new();
    if meta.is_dir() {
        folders.push((temp.clone(), meta.permissions()));
    }
    match fill_and_place(from, &temp, to, &mut folders) {
        Ok(more) => Ok(bytes + more),
        Err(err) => {
            remove_temp(&temp, &folders);
            Err(err)
        }
    }
}

/// Fill the folder at `temp` (nothing to fill for a file or a link), set every folder's permissions
/// innermost first, and rename `temp` to `to`. Until the permissions are set every folder stays
/// writable, so a failure can remove the whole tree.
fn fill_and_place(from: &Path, temp: &Path, to: &Path, folders: &mut Folders) -> io::Result<u64> {
    let bytes = if folders.is_empty() {
        0
    } else {
        fill(from, temp, folders)?
    };
    for (folder, permissions) in folders.iter().rev() {
        std::fs::set_permissions(folder, permissions.clone())
            .map_err(|err| with_path(err, folder))?;
    }
    std::fs::rename(temp, to).map_err(|err| with_path(err, to))?;
    Ok(bytes)
}

/// Copy what is in the folder `from` into the empty folder `to`, sub folders too.
fn fill(from: &Path, to: &Path, folders: &mut Folders) -> io::Result<u64> {
    let mut bytes = 0;
    for entry in std::fs::read_dir(from).map_err(|err| with_path(err, from))? {
        let entry = entry.map_err(|err| with_path(err, from))?;
        let (path, target) = (entry.path(), to.join(entry.file_name()));
        // A directory entry's metadata never follows a link.
        let meta = entry.metadata().map_err(|err| with_path(err, &path))?;
        bytes += make(&path, &meta, &target)?;
        if meta.is_dir() {
            folders.push((target.clone(), meta.permissions()));
            bytes += fill(&path, &target, folders)?;
        }
    }
    Ok(bytes)
}

/// Make `to` a copy of the one entry `from` and return the bytes copied: a file with its bytes and
/// permissions, an empty folder, or a link with the same target text. Creates nothing when it
/// fails. Anything else is refused before it is opened, since opening a FIFO blocks.
fn make(from: &Path, meta: &Metadata, to: &Path) -> io::Result<u64> {
    let file_type = meta.file_type();
    if file_type.is_symlink() {
        copy_link(from, meta, to).map(|()| 0)
    } else if file_type.is_dir() {
        std::fs::create_dir(to).map_err(|err| with_path(err, to))?;
        Ok(0)
    } else if file_type.is_file() {
        copy_file(from, meta.permissions(), to)
    } else {
        Err(refuse(
            io::ErrorKind::InvalidInput,
            from,
            "not a file, folder or link",
        ))
    }
}

/// Copy a file's bytes to the new file `to` and give it `permissions` once written, so a read-only
/// source gives a read-only copy. `to` is removed again when any step fails.
fn copy_file(from: &Path, permissions: Permissions, to: &Path) -> io::Result<u64> {
    let mut source = File::open(from).map_err(|err| with_path(err, from))?;
    let mut target = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(to)
        .map_err(|err| with_path(err, to))?;
    let result = io::copy(&mut source, &mut target)
        .map_err(|err| with_path(err, from))
        .and_then(|bytes| {
            target
                .set_permissions(permissions)
                .map_err(|err| with_path(err, to))?;
            Ok(bytes)
        });
    if result.is_err() {
        drop(target);
        let _ = std::fs::remove_file(to);
    }
    result
}

#[cfg(unix)]
fn copy_link(from: &Path, _meta: &Metadata, to: &Path) -> io::Result<()> {
    let target = std::fs::read_link(from).map_err(|err| with_path(err, from))?;
    std::os::unix::fs::symlink(target, to).map_err(|err| with_path(err, to))
}

/// A link to a folder is made as one; without the privilege to create links this fails.
#[cfg(windows)]
fn copy_link(from: &Path, meta: &Metadata, to: &Path) -> io::Result<()> {
    use std::os::windows::fs::{FileTypeExt as _, symlink_dir, symlink_file};
    let target = std::fs::read_link(from).map_err(|err| with_path(err, from))?;
    let made = if meta.file_type().is_symlink_dir() {
        symlink_dir(target, to)
    } else {
        symlink_file(target, to)
    };
    made.map_err(|err| with_path(err, to))
}

#[cfg(not(any(unix, windows)))]
fn copy_link(from: &Path, _meta: &Metadata, _to: &Path) -> io::Result<()> {
    Err(refuse(
        io::ErrorKind::Unsupported,
        from,
        "links cannot be copied here",
    ))
}

/// Remove what a failed copy left at `temp`, best effort. On Unix its folders are made writable
/// first, in case their permissions were already set.
fn remove_temp(temp: &Path, folders: &Folders) {
    #[cfg(unix)]
    for (folder, _) in folders {
        use std::os::unix::fs::PermissionsExt as _;
        let _ = std::fs::set_permissions(folder, Permissions::from_mode(0o700));
    }
    #[cfg(not(unix))]
    let _ = folders;
    let _ = match std::fs::symlink_metadata(temp) {
        Ok(meta) if meta.is_dir() => std::fs::remove_dir_all(temp),
        Ok(_) => std::fs::remove_file(temp),
        Err(_) => Ok(()),
    };
}
