//! `Core::handle`: one bridge request in, one bridge response out. Every primitive call passes the
//! permission engine first; methods the core does not serve yet answer `unsupported`.

use std::io;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

use desk_bridge::{
    BridgeError, BridgeFailure, BridgeRequest, BridgeResponse, BridgeSuccess, ErrorCode, False,
    Permission, RequestId, True,
};
use desk_sys::fs as sysfs;
use serde::Serialize;

use crate::conversation::Conversation;
use crate::events::EventBus;
use crate::paths::normalize;
use crate::perm::{Denied, PermissionEngine};
use crate::plugins::PluginRegistry;
use crate::prompt::{Prompter, RefuseAll};
use crate::resources::Table;
use crate::store::Store;

/// Where root tokens in bridge paths point.
#[derive(Debug, Clone)]
pub struct Roots {
    /// `~` and `${home}`.
    pub home: PathBuf,
}

pub(crate) type Answer = Result<serde_json::Value, BridgeError>;

pub struct Core {
    roots: Roots,
    permissions: Mutex<PermissionEngine>,
    events: EventBus,
    pub(crate) prompter: Box<dyn Prompter>,
    /// What the person refused this session, per caller. Its lock is held while a prompt is
    /// open: the person answers one question at a time.
    pub(crate) refusals: Mutex<Vec<(String, Permission)>>,
    pub(crate) plugins: Mutex<PluginRegistry>,
    pub(crate) store: Mutex<Store>,
    pub(crate) conversation: Option<Arc<Conversation>>,
    /// Only built-in plugins run: other plugins are listed but get no permissions.
    pub(crate) safe_mode: bool,
    pub(crate) watches: Mutex<Table<sysfs::Watch>>,
}

impl Core {
    pub fn new(roots: Roots) -> Self {
        Self {
            roots,
            permissions: Mutex::new(PermissionEngine::new()),
            events: EventBus::new(),
            prompter: Box::new(RefuseAll),
            refusals: Mutex::new(Vec::new()),
            plugins: Mutex::new(PluginRegistry::new(None)),
            store: Mutex::new(Store::new(None)),
            conversation: None,
            safe_mode: false,
            watches: Mutex::new(Table::new("w")),
        }
    }

    pub fn with_prompter(mut self, prompter: impl Prompter + 'static) -> Self {
        self.prompter = Box::new(prompter);
        self
    }

    pub fn events(&self) -> &EventBus {
        &self.events
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
            R::FsRead(r) => (r.id, self.fs_read(caller, r.params)),
            R::FsList(r) => (r.id, self.fs_list(caller, r.params)),
            R::FsWrite(r) => (r.id, self.fs_write(caller, r.params)),
            R::FsWatch(r) => (r.id, self.fs_watch(caller, r.params)),
            R::PermQuery(r) => (r.id, self.perm_query(caller, r.params)),
            R::PermRequest(r) => (r.id, self.perm_request(caller, r.params)),
            R::PermRevoke(r) => (r.id, self.perm_revoke(caller, r.params)),
            R::PluginList(r) => (r.id, self.plugin_list(caller, r.params)),
            R::PluginSetEnabled(r) => (r.id, self.plugin_set_enabled(caller, r.params)),
            R::StoreGet(r) => (r.id, self.store_get(caller, r.params)),
            R::StoreSet(r) => (r.id, self.store_set(caller, r.params)),
            R::BrainSay(r) => (r.id, self.brain_say(caller, r.params)),
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

    pub(crate) fn resolve(&self, path: &str) -> Result<PathBuf, BridgeError> {
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

    /// End the work a revoked grant allowed.
    pub(crate) fn release_grant(&self, grant_id: &str) {
        drop(self.watches().drain_where(|e| e.grant == grant_id));
    }

    /// End the work a plugin started, when it is turned off.
    pub(crate) fn release_caller(&self, caller: &str) {
        drop(self.watches().drain_where(|e| e.caller == caller));
    }
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

pub(crate) fn io_error(err: io::Error) -> BridgeError {
    let code = match err.kind() {
        io::ErrorKind::NotFound => ErrorCode::NotFound,
        io::ErrorKind::IsADirectory
        | io::ErrorKind::NotADirectory
        | io::ErrorKind::InvalidInput => ErrorCode::InvalidParams,
        _ => ErrorCode::IoError,
    };
    error(code, err.to_string())
}
