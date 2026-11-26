//! An agent's granted writes need either a retained version or a new file they can take back.

use std::fs::{self, File};
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};

use desk_bridge::{BridgeError, ErrorCode, Permission};
use desk_sys::fs as sysfs;
use sha2::{Digest, Sha256};

use crate::handler::{Core, denied, error, io_error};
use crate::history::real_path;
use crate::paths::normalize;
use crate::perm::{Denied, Target, scope_allows};

pub(crate) struct FileChange {
    pub(crate) path: String,
    pub(crate) version: Option<String>,
    real: PathBuf,
    len: u64,
    digest: [u8; 32],
    parents: Vec<PathBuf>,
}

impl FileChange {
    pub(crate) fn new(
        path: &str,
        file: &Path,
        bytes: &[u8],
        version: Option<String>,
        parents: Vec<PathBuf>,
    ) -> Self {
        Self {
            path: path.to_owned(),
            version,
            real: real_path(file),
            len: bytes.len() as u64,
            digest: Sha256::digest(bytes).into(),
            parents,
        }
    }

    pub(crate) fn verify(&self, file: &Path) -> Result<(), BridgeError> {
        let changed = || {
            error(
                ErrorCode::AlreadyExists,
                "This file changed after it was saved".to_owned(),
            )
        };
        let meta = fs::symlink_metadata(file).map_err(io_error)?;
        if real_path(file) != self.real || !meta.is_file() || meta.len() != self.len {
            return Err(changed());
        }
        let mut contents = File::open(file)
            .map_err(io_error)?
            .take(self.len.saturating_add(1));
        let mut digest = Sha256::new();
        let mut chunk = [0; 8192];
        loop {
            let len = contents.read(&mut chunk).map_err(io_error)?;
            if len == 0 {
                break;
            }
            digest.update(&chunk[..len]);
        }
        if digest.finalize()[..] != self.digest {
            return Err(changed());
        }
        Ok(())
    }

    pub(crate) fn remove_empty_parents(&self) {
        remove_empty_parents(&self.parents);
    }
}

impl Core {
    /// Attempt a single reversible mutation. None leaves the destination untouched and requires
    /// action approval before trying an ordinary write.
    pub(super) fn write_reversibly(
        &self,
        caller: &str,
        scope: &Permission,
        path: &str,
        file: &Path,
        bytes: &[u8],
        create_dirs: bool,
    ) -> Result<Option<(u64, FileChange)>, BridgeError> {
        match fs::symlink_metadata(file) {
            Ok(meta) if meta.is_file() => {
                let result = self.write_if_version_kept(caller, file, bytes)?;
                Ok(result.map(|(written, version)| {
                    (
                        written,
                        FileChange::new(path, file, bytes, Some(version), Vec::new()),
                    )
                }))
            }
            Ok(_) => Ok(None),
            Err(why) if why.kind() == ErrorKind::NotFound => {
                let _history = self.history();
                let parents = if create_dirs {
                    make_parents(scope, path, file)?
                } else {
                    Vec::new()
                };
                match sysfs::write_new(file, bytes) {
                    Ok(written) => Ok(Some((
                        written,
                        FileChange::new(path, file, bytes, None, parents),
                    ))),
                    Err(why) => {
                        remove_empty_parents(&parents);
                        match why.kind() {
                            ErrorKind::AlreadyExists | ErrorKind::Unsupported => Ok(None),
                            _ => Err(io_error(why)),
                        }
                    }
                }
            }
            Err(why) => Err(io_error(why)),
        }
    }
}

fn make_parents(scope: &Permission, path: &str, file: &Path) -> Result<Vec<PathBuf>, BridgeError> {
    let Some(parent) = file.parent() else {
        return Ok(Vec::new());
    };
    if parent.is_dir() {
        return Ok(Vec::new());
    }
    let rooted = normalize(path).unwrap_or_else(|| path.to_owned());
    let mut prefix = rooted.as_str();
    for folder in file.ancestors().skip(1) {
        if fs::symlink_metadata(folder).is_ok() {
            break;
        }
        let Some((next, _)) = prefix.rsplit_once('/') else {
            break;
        };
        prefix = next;
        let target = Target::Path(prefix);
        if !scope_allows(scope, &target) {
            return Err(denied(Denied {
                reason: format!("the scope does not cover {target:?}"),
                permission: scope.clone(),
            }));
        }
    }
    match sysfs::mkdir(parent, true) {
        Ok(created) => Ok(created
            .into_iter()
            .map(|dir| fs::canonicalize(&dir).unwrap_or(dir))
            .collect()),
        Err(why) if why.kind() == ErrorKind::AlreadyExists && parent.is_dir() => Ok(Vec::new()),
        Err(why) => Err(io_error(why)),
    }
}

fn remove_empty_parents(parents: &[PathBuf]) {
    for folder in parents.iter().rev() {
        match fs::remove_dir(folder) {
            Ok(()) => {}
            Err(why) if why.kind() == ErrorKind::NotFound => {}
            Err(_) => break,
        }
    }
}
