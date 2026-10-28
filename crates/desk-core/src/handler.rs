//! `Core::handle`: one bridge request in, one bridge response out. Every primitive call passes the
//! permission engine first; methods the core does not serve yet answer `unsupported`.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use base64::Engine as _;
use desk_bridge::{
    BridgeError, BridgeEvent, BridgeFailure, BridgeRequest, BridgeResponse, BridgeSuccess,
    DirEntry, Encoding, EntryKind, ErrorCode, False, FsListResult, FsReadResult, Grant,
    GrantChange, PermChangedData, PermChangedEvent, PermQueryResult, PermRequestResult,
    PermRevokeResult, Permission, RequestId, True,
};
use desk_sys::fs as sysfs;
use serde::Serialize;

use crate::conversation::Conversation;
use crate::events::EventBus;
use crate::paths::normalize;
use crate::perm::{Denied, PermissionEngine, Target, covers};
use crate::plugins::PluginRegistry;
use crate::store::Store;

/// Where root tokens in bridge paths point.
#[derive(Debug, Clone)]
pub struct Roots {
    /// `~` and `${home}`.
    pub home: PathBuf,
}

/// Asks the person whether to grant a permission. Desk's prompt UI implements this.
pub trait Prompter: Send + Sync {
    fn ask(&self, caller: &str, permission: &Permission, reason: &str) -> bool;
}

/// The prompter used until a prompt UI exists: it refuses everything.
#[derive(Debug, Default)]
pub struct RefuseAll;

impl Prompter for RefuseAll {
    fn ask(&self, _caller: &str, _permission: &Permission, _reason: &str) -> bool {
        false
    }
}

pub(crate) type Answer = Result<serde_json::Value, BridgeError>;

pub struct Core {
    roots: Roots,
    permissions: Mutex<PermissionEngine>,
    events: EventBus,
    prompter: Box<dyn Prompter>,
    pub(crate) plugins: Mutex<PluginRegistry>,
    pub(crate) store: Mutex<Store>,
    pub(crate) conversation: Option<Arc<Conversation>>,
}

impl Core {
    pub fn new(roots: Roots) -> Self {
        Self {
            roots,
            permissions: Mutex::new(PermissionEngine::new()),
            events: EventBus::new(),
            prompter: Box::new(RefuseAll),
            plugins: Mutex::new(PluginRegistry::new(None)),
            store: Mutex::new(Store::new(None)),
            conversation: None,
        }
    }

    pub fn with_prompter(mut self, prompter: impl Prompter + 'static) -> Self {
        self.prompter = Box::new(prompter);
        self
    }

    pub fn events(&self) -> &EventBus {
        &self.events
    }

    /// Grant directly, as the person would through a prompt.
    pub fn grant(&self, caller: &str, permission: Permission) -> Grant {
        let grant = self.permissions().grant(caller, permission);
        self.changed(&grant.grant_id, GrantChange::Granted);
        grant
    }

    pub fn handle(&self, caller: &str, request: BridgeRequest) -> BridgeResponse {
        let (id, answer) = self.dispatch(caller, request);
        match answer {
            Ok(result) => BridgeResponse::BridgeSuccess(BridgeSuccess {
                id,
                ok: True,
                result,
            }),
            Err(error) => BridgeResponse::BridgeFailure(BridgeFailure {
                id,
                ok: False,
                error,
            }),
        }
    }

    fn dispatch(&self, caller: &str, request: BridgeRequest) -> (RequestId, Answer) {
        use BridgeRequest as R;
        match request {
            R::FsRead(r) => {
                let scope = Permission::FsRead(r.params.scope);
                let answer = self
                    .authorize(caller, &scope, &r.params.path)
                    .and_then(|path| read(&path, r.params.encoding.unwrap_or(Encoding::Utf8)));
                (r.id, answer)
            }
            R::FsList(r) => {
                let scope = Permission::FsRead(r.params.scope);
                let answer = self
                    .authorize(caller, &scope, &r.params.path)
                    .and_then(|path| list(&path));
                (r.id, answer)
            }
            R::PermQuery(r) => {
                let mut grants = self.permissions().grants(caller);
                if let Some(filter) = &r.params.permission {
                    grants.retain(|grant| covers(&grant.permission, filter));
                }
                (r.id, json(PermQueryResult { grants }))
            }
            R::PermRequest(r) => {
                let params = r.params;
                let answer = if self
                    .prompter
                    .ask(caller, &params.permission, &params.reason)
                {
                    let grant = self.grant(caller, params.permission);
                    json(PermRequestResult {
                        granted: true,
                        grant: Some(grant),
                    })
                } else {
                    json(PermRequestResult {
                        granted: false,
                        grant: None,
                    })
                };
                (r.id, answer)
            }
            R::PermRevoke(r) => {
                let answer = if self.permissions().revoke(caller, &r.params.grant_id) {
                    self.changed(&r.params.grant_id, GrantChange::Revoked);
                    json(PermRevokeResult {})
                } else {
                    Err(error(
                        ErrorCode::NotFound,
                        format!("no grant {}", r.params.grant_id),
                    ))
                };
                (r.id, answer)
            }
            R::PluginList(r) => (r.id, self.plugin_list(caller, r.params)),
            R::PluginSetEnabled(r) => (r.id, self.plugin_set_enabled(caller, r.params)),
            R::StoreGet(r) => (r.id, self.store_get(caller, r.params)),
            R::StoreSet(r) => (r.id, self.store_set(caller, r.params)),
            R::BrainSay(r) => (r.id, self.brain_say(caller, r.params)),
            R::FsWrite(r) => (r.id, unsupported("fs.write")),
            R::FsWatch(r) => (r.id, unsupported("fs.watch")),
            R::ProcSpawn(r) => (r.id, unsupported("proc.spawn")),
            R::ProcWrite(r) => (r.id, unsupported("proc.write")),
            R::ProcResize(r) => (r.id, unsupported("proc.resize")),
            R::ProcKill(r) => (r.id, unsupported("proc.kill")),
            R::NetFetch(r) => (r.id, unsupported("net.fetch")),
            R::AudioCaptureStart(r) => (r.id, unsupported("audio.capture.start")),
            R::AudioCaptureStop(r) => (r.id, unsupported("audio.capture.stop")),
            R::UiSurfaceOpen(r) => (r.id, unsupported("ui.surface.open")),
            R::UiSurfaceClose(r) => (r.id, unsupported("ui.surface.close")),
            R::UiNotify(r) => (r.id, unsupported("ui.notify")),
        }
    }

    /// Check the scope against the caller's grants, then map the bridge path onto the file system.
    fn authorize(
        &self,
        caller: &str,
        scope: &Permission,
        path: &str,
    ) -> Result<PathBuf, BridgeError> {
        self.permissions()
            .authorize(caller, scope, &Target::Path(path))
            .map_err(denied)?;
        self.resolve(path)
    }

    fn resolve(&self, path: &str) -> Result<PathBuf, BridgeError> {
        let normalized = normalize(path).ok_or_else(|| {
            error(
                ErrorCode::InvalidParams,
                format!("not a rooted path: {path}"),
            )
        })?;
        let (root, rest) = normalized
            .split_once('/')
            .unwrap_or((normalized.as_str(), ""));
        let base = match root {
            "~" => self.roots.home.clone(),
            "" => PathBuf::from("/"),
            drive if drive.len() == 2 && drive.ends_with(':') => PathBuf::from(format!("{drive}/")),
            other => {
                return Err(error(
                    ErrorCode::InvalidParams,
                    format!("{other} paths are not available to this caller"),
                ));
            }
        };
        Ok(rest
            .split('/')
            .filter(|s| !s.is_empty())
            .fold(base, |p, s| p.join(s)))
    }

    pub(crate) fn permissions(&self) -> MutexGuard<'_, PermissionEngine> {
        self.permissions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn changed(&self, grant_id: &str, change: GrantChange) {
        self.events
            .publish(BridgeEvent::PermChanged(PermChangedEvent {
                event: Default::default(),
                data: PermChangedData {
                    grant_id: grant_id.to_owned(),
                    change,
                },
            }));
    }
}

fn read(path: &Path, encoding: Encoding) -> Answer {
    let bytes = sysfs::read(path).map_err(io_error)?;
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

fn list(path: &Path) -> Answer {
    let entries = sysfs::list(path)
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

pub(crate) fn json(value: impl Serialize) -> Answer {
    serde_json::to_value(value).map_err(|e| error(ErrorCode::Internal, e.to_string()))
}

pub(crate) fn error(code: ErrorCode, message: String) -> BridgeError {
    BridgeError {
        code,
        message,
        permission: None,
    }
}

pub(crate) fn denied(denied: Denied) -> BridgeError {
    BridgeError {
        code: ErrorCode::PermissionDenied,
        message: denied.reason,
        permission: Some(denied.permission),
    }
}

fn unsupported(method: &str) -> Answer {
    Err(error(
        ErrorCode::Unsupported,
        format!("{method} is not served by the core yet"),
    ))
}

fn io_error(err: io::Error) -> BridgeError {
    let code = match err.kind() {
        io::ErrorKind::NotFound => ErrorCode::NotFound,
        io::ErrorKind::IsADirectory
        | io::ErrorKind::NotADirectory
        | io::ErrorKind::InvalidInput => ErrorCode::InvalidParams,
        _ => ErrorCode::IoError,
    };
    error(code, err.to_string())
}
