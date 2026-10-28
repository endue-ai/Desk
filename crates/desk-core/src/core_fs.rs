//! The file side of `Core`: fs.read, fs.list, fs.write and fs.watch. Every file call passes the
//! permission engine and then the symlink rule: below the part of a path the person granted
//! literally, no component may be a symbolic link, so a link inside `~/Documents` cannot lead a
//! caller out of it.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::MutexGuard;

use base64::Engine as _;
use desk_bridge::{
    BridgeError, DirEntry, Encoding, EntryKind, ErrorCode, FsListParams, FsListResult,
    FsReadParams, FsReadResult, FsWatchParams, FsWatchResult, FsWriteParams, FsWriteResult,
    Permission,
};
use desk_sys::fs as sysfs;

use crate::fs_watch;
use crate::handler::{Answer, Core, denied, error, io_error, json};
use crate::paths::{glob_match, normalize};
use crate::perm::{Denied, Target};
use crate::resources::Table;

impl Core {
    pub(crate) fn fs_read(&self, caller: &str, params: FsReadParams) -> Answer {
        let scope = Permission::FsRead(params.scope);
        let (path, _) = self.authorize_path(caller, &scope, &params.path)?;
        let bytes = sysfs::read(&path).map_err(io_error)?;
        let encoding = params.encoding.unwrap_or(Encoding::Utf8);
        let content = match encoding {
            Encoding::Utf8 => String::from_utf8(bytes).map_err(|_| {
                error(
                    ErrorCode::InvalidParams,
                    "the file is not UTF-8; read it as base64".to_owned(),
                )
            })?,
            Encoding::Base64 => base64::engine::general_purpose::STANDARD.encode(bytes),
        };
        json(FsReadResult { content, encoding })
    }

    pub(crate) fn fs_list(&self, caller: &str, params: FsListParams) -> Answer {
        let scope = Permission::FsRead(params.scope);
        let (path, _) = self.authorize_path(caller, &scope, &params.path)?;
        let entries = sysfs::list(&path)
            .map_err(io_error)?
            .into_iter()
            .map(|entry| DirEntry {
                name: entry.name,
                kind: match entry.kind {
                    sysfs::EntryKind::File => EntryKind::File,
                    sysfs::EntryKind::Dir => EntryKind::Dir,
                    sysfs::EntryKind::Symlink => EntryKind::Symlink,
                },
                size: entry.size,
            })
            .collect();
        json(FsListResult { entries })
    }

    pub(crate) fn fs_write(&self, caller: &str, params: FsWriteParams) -> Answer {
        let patterns = params.scope.paths.clone();
        let scope = Permission::FsWrite(params.scope);
        let (path, _) = self.authorize_path(caller, &scope, &params.path)?;
        let bytes = decode(&params.content, params.encoding.unwrap_or(Encoding::Utf8))?;
        if params.create_dirs == Some(true) {
            self.create_parents(&scope, &patterns, &params.path)?;
        }
        let bytes_written = sysfs::write(&path, &bytes).map_err(io_error)?;
        json(FsWriteResult { bytes_written })
    }

    pub(crate) fn fs_watch(&self, caller: &str, params: FsWatchParams) -> Answer {
        let patterns = params.scope.paths.clone();
        let scope = Permission::FsRead(params.scope);
        let (root, grant) = self.authorize_path(caller, &scope, &params.path)?;
        let bridge_root = normalize(&params.path).unwrap_or(params.path);
        let mut watches = self.watches();
        let watch_id = watches.next_id();
        let watch = fs_watch::start(fs_watch::Spec {
            watch_id: watch_id.clone(),
            root,
            bridge_root,
            patterns,
            recursive: params.recursive == Some(true),
            events: self.events().clone(),
        })
        .map_err(io_error)?;
        watches.insert(watch_id.clone(), caller, &grant, watch);
        json(FsWatchResult { watch_id })
    }

    /// Check the scope against the caller's grants and the path against the symlink rule, then map
    /// the bridge path onto the file system. Returns the path and the id of the grant that allowed it.
    pub(crate) fn authorize_path(
        &self,
        caller: &str,
        scope: &Permission,
        path: &str,
    ) -> Result<(PathBuf, String), BridgeError> {
        let (grant_id, granted) = {
            let engine = self.permissions();
            let grant_id = engine
                .authorize(caller, scope, &Target::Path(path))
                .map_err(denied)?;
            let granted = engine
                .grants(caller)
                .into_iter()
                .find(|grant| grant.grant_id == grant_id)
                .map(|grant| grant.permission);
            (grant_id, granted)
        };
        let patterns = match granted {
            Some(Permission::FsRead(p)) => p.paths,
            Some(Permission::FsWrite(p)) => p.paths,
            _ => Vec::new(),
        };
        let resolved = self.resolve(path)?;
        self.confine(&patterns, path, scope)?;
        Ok((resolved, grant_id))
    }

    /// Refuse a path that passes through a symbolic link below the literal part of the grant that
    /// covers it (`~/Documents` for `~/Documents/**`; the parent for a pattern without wildcards).
    fn confine(
        &self,
        granted: &[String],
        path: &str,
        scope: &Permission,
    ) -> Result<(), BridgeError> {
        let Some(path) = normalize(path) else {
            return Ok(());
        };
        let Some(trusted) = granted
            .iter()
            .filter(|pattern| glob_match(pattern, &path))
            .filter_map(|pattern| literal_prefix(pattern))
            .max_by_key(String::len)
        else {
            return Ok(());
        };
        let mut current = self.resolve(&trusted)?;
        for segment in path[trusted.len()..].split('/').filter(|s| !s.is_empty()) {
            current.push(segment);
            match fs::symlink_metadata(&current) {
                Ok(meta) if meta.file_type().is_symlink() => {
                    return Err(denied(Denied {
                        permission: scope.clone(),
                        reason: format!("{path} passes through a symbolic link"),
                    }));
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        Ok(())
    }

    /// Create the missing parent folders of `path`, each of which must be inside `patterns`.
    fn create_parents(
        &self,
        scope: &Permission,
        patterns: &[String],
        path: &str,
    ) -> Result<(), BridgeError> {
        let mut missing = Vec::new();
        let mut next = normalize(path).and_then(|p| parent(&p));
        while let Some(dir) = next {
            let on_disk = self.resolve(&dir)?;
            if fs::symlink_metadata(&on_disk).is_ok() {
                break;
            }
            if !patterns.iter().any(|pattern| glob_match(pattern, &dir)) {
                return Err(denied(Denied {
                    permission: scope.clone(),
                    reason: format!("creating {dir} is outside the scope"),
                }));
            }
            next = parent(&dir);
            missing.push(on_disk);
        }
        for dir in missing.iter().rev() {
            create_dir(dir)?;
        }
        Ok(())
    }

    pub(crate) fn watches(&self) -> MutexGuard<'_, Table<sysfs::Watch>> {
        self.watches
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn create_dir(dir: &Path) -> Result<(), BridgeError> {
    match fs::create_dir(dir) {
        Err(e) if e.kind() != std::io::ErrorKind::AlreadyExists => Err(io_error(e)),
        _ => Ok(()),
    }
}

fn decode(content: &str, encoding: Encoding) -> Result<Vec<u8>, BridgeError> {
    match encoding {
        Encoding::Utf8 => Ok(content.as_bytes().to_vec()),
        Encoding::Base64 => base64::engine::general_purpose::STANDARD
            .decode(content)
            .map_err(|e| {
                error(
                    ErrorCode::InvalidParams,
                    format!("content is not base64: {e}"),
                )
            }),
    }
}

/// The folder a normalised bridge path is in; `None` for a root.
fn parent(path: &str) -> Option<String> {
    let (head, tail) = path.rsplit_once('/')?;
    if tail.is_empty() {
        return None;
    }
    Some(if head.is_empty() {
        "/".to_owned()
    } else {
        head.to_owned()
    })
}

/// The leading segments of a pattern without wildcards, minus the last one when the whole pattern is
/// literal, so the file it names is checked too.
fn literal_prefix(pattern: &str) -> Option<String> {
    let pattern = normalize(pattern)?;
    let segments: Vec<&str> = pattern.split('/').collect();
    let mut literal: Vec<&str> = segments
        .iter()
        .take_while(|s| !s.contains(['*', '?']))
        .copied()
        .collect();
    if literal.len() == segments.len() {
        literal.pop();
    }
    let joined = literal.join("/");
    Some(if joined.is_empty() {
        "/".to_owned()
    } else {
        joined
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn literal_prefixes_stop_at_the_first_wildcard() {
        assert_eq!(
            literal_prefix("~/Documents/**").as_deref(),
            Some("~/Documents")
        );
        assert_eq!(literal_prefix("~/notes.md").as_deref(), Some("~"));
        assert_eq!(literal_prefix("/srv/*/logs/**").as_deref(), Some("/srv"));
        assert_eq!(literal_prefix("/**").as_deref(), Some("/"));
    }

    #[test]
    fn parents_walk_up_to_the_root() {
        assert_eq!(parent("~/a/b").as_deref(), Some("~/a"));
        assert_eq!(parent("~/a").as_deref(), Some("~"));
        assert_eq!(parent("/a").as_deref(), Some("/"));
        assert_eq!(parent("/"), None);
        assert_eq!(parent("~"), None);
    }
}
