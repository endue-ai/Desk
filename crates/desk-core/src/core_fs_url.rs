//! fs.url: a short-lived URL for one file the caller may read, which its frame loads from the
//! app's `desk-plugin` scheme instead of passing the bytes through the bridge (ADR 0041). The
//! token is 128 random bits and lives in memory only. `Core::file_url` resolves it on every request
//! the scheme gets, and only while the caller runs and still holds an `fs:read` grant that covers
//! the path; a token ends for good with its caller (unloaded), with the last such grant (revoked,
//! spent) and with the core.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::MutexGuard;

use desk_bridge::{ErrorCode, FsReadPermission, FsUrlParams, FsUrlResult, Permission};

use crate::handler::{Answer, Core, error, io_error, json};
use crate::media_types::media_type;
use crate::paths::normalize;
use crate::perm::Target;

/// How many URLs one caller keeps; making one more forgets its oldest.
const MAX_PER_CALLER: usize = 1024;

/// The file a URL token names, for the app's `desk-plugin` scheme.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileUrl {
    pub path: PathBuf,
    /// The `Content-Type` to serve it with (fs.url's `type`).
    pub media_type: &'static str,
}

struct Entry {
    caller: String,
    /// The bridge path, normalised, which a grant must still cover.
    path: String,
    /// The scope fs.url was called with.
    scope: Permission,
    file: FileUrl,
    made: u64,
}

/// The URLs callers hold, by token.
#[derive(Default)]
pub(crate) struct FileUrls {
    made: u64,
    entries: HashMap<String, Entry>,
}

impl Core {
    pub(crate) fn fs_url(&self, caller: &str, params: FsUrlParams) -> Answer {
        let scope = Permission::FsRead(params.scope);
        let file = self.authorize(caller, &scope, &params.path)?;
        let metadata = std::fs::metadata(&file).map_err(io_error)?;
        if metadata.is_dir() {
            let message = format!("{} is a folder; fs.url names a file", params.path);
            return Err(error(ErrorCode::InvalidParams, message));
        }
        let name = file
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let token = token()?;
        let media_type = media_type(&name);
        let url = format!("/_desk/file/{token}/{}", encode(&name));
        {
            let mut urls = self.file_urls();
            urls.made += 1;
            let made = urls.made;
            let entry = Entry {
                caller: caller.to_owned(),
                path: normalize(&params.path).unwrap_or(params.path),
                scope,
                file: FileUrl {
                    path: file,
                    media_type,
                },
                made,
            };
            urls.entries.insert(token, entry);
            urls.forget_beyond_the_limit(caller);
        }
        // One made under a once grant ends with the call that spent it.
        self.prune_file_urls(caller);
        json(FsUrlResult {
            url,
            size: metadata.len(),
            r#type: media_type.to_owned(),
        })
    }

    /// The file `token` names, while its caller runs and a grant of the caller's covers the path;
    /// `None` for a token the core never made or one that ended.
    pub fn file_url(&self, token: &str) -> Option<FileUrl> {
        let (caller, path, scope, file) = {
            let urls = self.file_urls();
            let e = urls.entries.get(token)?;
            (
                e.caller.clone(),
                e.path.clone(),
                e.scope.clone(),
                e.file.clone(),
            )
        };
        (self.running(&caller) && self.covers_path(&caller, &path, &scope)).then_some(file)
    }

    /// The caller lost a grant: its URLs that no grant covers any more end.
    pub(crate) fn prune_file_urls(&self, caller: &str) {
        let held: Vec<(String, String, Permission)> = self
            .file_urls()
            .entries
            .iter()
            .filter(|(_, e)| e.caller == caller)
            .map(|(token, e)| (token.clone(), e.path.clone(), e.scope.clone()))
            .collect();
        let ended: Vec<String> = held
            .into_iter()
            .filter(|(_, path, scope)| !self.covers_path(caller, path, scope))
            .map(|(token, _, _)| token)
            .collect();
        let mut urls = self.file_urls();
        for token in ended {
            urls.entries.remove(&token);
        }
    }

    /// The caller unloaded: its URLs end.
    pub(crate) fn drop_file_urls(&self, caller: &str) {
        self.file_urls().entries.retain(|_, e| e.caller != caller);
    }

    /// How many URLs are live, for tests and diagnostics.
    pub fn file_url_count(&self) -> usize {
        self.file_urls().entries.len()
    }

    /// Whether a grant of `caller`'s covers `path`: one covering that path alone, or the scope the
    /// URL was made under (which covers the path; it also handles names with `*` or `?` in them).
    /// Nothing is spent.
    fn covers_path(&self, caller: &str, path: &str, scope: &Permission) -> bool {
        let target = Target::Path(path);
        let alone = Permission::FsRead(FsReadPermission {
            permission: Default::default(),
            paths: vec![path.to_owned()],
        });
        let permissions = self.permissions();
        permissions.authorize(caller, &alone, &target).is_ok()
            || permissions.authorize(caller, scope, &target).is_ok()
    }

    fn file_urls(&self) -> MutexGuard<'_, FileUrls> {
        self.file_urls
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl FileUrls {
    /// Keep the caller's newest `MAX_PER_CALLER` URLs.
    fn forget_beyond_the_limit(&mut self, caller: &str) {
        let mut mine: Vec<(u64, String)> = self
            .entries
            .iter()
            .filter(|(_, e)| e.caller == caller)
            .map(|(token, e)| (e.made, token.clone()))
            .collect();
        if mine.len() <= MAX_PER_CALLER {
            return;
        }
        mine.sort();
        for (_, token) in &mine[..mine.len() - MAX_PER_CALLER] {
            self.entries.remove(token);
        }
    }
}

/// 128 random bits from the OS, as 32 lowercase hex digits.
fn token() -> Result<String, desk_bridge::BridgeError> {
    let mut bits = [0u8; 16];
    getrandom::fill(&mut bits).map_err(|e| {
        error(
            ErrorCode::Internal,
            format!("no randomness for a token: {e}"),
        )
    })?;
    Ok(bits.iter().map(|b| format!("{b:02x}")).collect())
}

/// A file name as one URL path segment: everything but the unreserved characters percent-encoded.
fn encode(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for byte in name.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    if out.is_empty() {
        "file".to_owned()
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_one_encoded_segment() {
        assert_eq!(encode("Holiday 2026.mp4"), "Holiday%202026.mp4");
        assert_eq!(encode("a/b?#%.mp3"), "a%2Fb%3F%23%25.mp3");
        assert_eq!(encode("밤.mov"), "%EB%B0%A4.mov");
        assert_eq!(encode(""), "file");
    }

    #[test]
    fn tokens_are_32_hex_digits() {
        let token = token().unwrap();
        assert_eq!(token.len(), 32);
        assert!(
            token
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        );
    }
}
