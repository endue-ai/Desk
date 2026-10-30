//! `Core::handle`: one bridge request in, one bridge response out. Every primitive call passes the
//! permission engine first (`Core::check`); methods the core does not serve yet answer `unsupported`.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex, MutexGuard};

use base64::Engine as _;
use desk_bridge::{
    BridgeError, BridgeFailure, BridgeRequest, BridgeResponse, BridgeSuccess, DirEntry, Encoding,
    EntryKind, ErrorCode, False, FsListResult, FsReadResult, Permission, RequestId, True,
};
use desk_sys::fs as sysfs;
use serde::Serialize;

use crate::conversation::Conversation;
use crate::core_cmd::Commands;
use crate::core_events::Subscriptions;
use crate::core_fs::Watches;
use crate::core_perm::{Prompter, RefuseAll};
use crate::core_prompts::Prompts;
use crate::events::EventBus;
use crate::init::InitFile;
use crate::paths::normalize;
use crate::perm::{Denied, PermissionEngine, Target};
use crate::plugins::PluginRegistry;
use crate::store::Store;
use crate::sync::Syncer;

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
    pub(crate) prompts: Mutex<Prompts>,
    pub(crate) subscriptions: Mutex<Subscriptions>,
    pub(crate) plugins: Mutex<PluginRegistry>,
    pub(crate) store: Mutex<Store>,
    pub(crate) conversation: Option<Arc<Conversation>>,
    pub(crate) init: Mutex<InitFile>,
    pub(crate) sync: Option<Syncer>,
    pub(crate) notifications: AtomicU64,
    pub(crate) watches: Mutex<Watches>,
    pub(crate) commands: Mutex<Commands>,
}

impl Core {
    pub fn new(roots: Roots) -> Self {
        Self {
            roots,
            permissions: Mutex::new(PermissionEngine::new()),
            events: EventBus::new(),
            prompter: Box::new(RefuseAll),
            prompts: Mutex::new(Prompts::default()),
            subscriptions: Mutex::new(Subscriptions::default()),
            plugins: Mutex::new(PluginRegistry::new(None)),
            store: Mutex::new(Store::new(None)),
            conversation: None,
            init: Mutex::new(InitFile::memory()),
            sync: None,
            notifications: AtomicU64::new(0),
            watches: Mutex::new(Watches::default()),
            commands: Mutex::new(Commands::default()),
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
            R::PermQuery(r) => (r.id, self.perm_query(caller, r.params)),
            R::PermRequest(r) => (r.id, self.perm_request(caller, r.params)),
            R::PermRevoke(r) => (r.id, self.perm_revoke(caller, r.params)),
            R::PermList(r) => (r.id, self.perm_list(caller, r.params)),
            R::PermAnswer(r) => (r.id, self.perm_answer(caller, r.params)),
            R::PluginList(r) => (r.id, self.plugin_list(caller, r.params)),
            R::PluginSetEnabled(r) => (r.id, self.plugin_set_enabled(caller, r.params)),
            R::StoreGet(r) => (r.id, self.store_get(caller, r.params)),
            R::StoreSet(r) => (r.id, self.store_set(caller, r.params)),
            R::BrainSay(r) => (r.id, self.brain_say(caller, r.params)),
            R::BrainAgentsList(r) => (r.id, self.brain_agents_list(caller, r.params)),
            R::BrainAgentsCard(r) => (r.id, self.brain_agents_card(caller, r.params)),
            R::BrainSpacesList(r) => (r.id, self.brain_spaces_list(caller, r.params)),
            R::BrainTasksList(r) => (r.id, self.brain_tasks_list(caller, r.params)),
            R::BrainStatus(r) => (r.id, self.brain_status(caller, r.params)),
            R::InitGet(r) => (r.id, self.init_get(caller)),
            R::UiNotify(r) => (r.id, self.notify(caller, r.params)),
            R::FsWrite(r) => (r.id, self.fs_write(caller, r.params)),
            R::FsWatch(r) => (r.id, self.fs_watch(caller, r.params)),
            R::ProcSpawn(r) => (r.id, unsupported("proc.spawn")),
            R::ProcWrite(r) => (r.id, unsupported("proc.write")),
            R::ProcResize(r) => (r.id, unsupported("proc.resize")),
            R::ProcKill(r) => (r.id, unsupported("proc.kill")),
            R::NetFetch(r) => (r.id, unsupported("net.fetch")),
            R::AudioCaptureStart(r) => (r.id, unsupported("audio.capture.start")),
            R::AudioCaptureStop(r) => (r.id, unsupported("audio.capture.stop")),
            R::UiSurfaceOpen(r) => (r.id, unsupported("ui.surface.open")),
            R::UiSurfaceClose(r) => (r.id, unsupported("ui.surface.close")),
            R::CmdRegister(r) => (r.id, self.cmd_register(caller, r.params)),
            R::CmdUnregister(r) => (r.id, self.cmd_unregister(caller, r.params)),
            R::CmdList(r) => (r.id, self.cmd_list(caller, r.params)),
            R::CmdInvoke(r) => (r.id, self.cmd_invoke(caller, r.params)),
            R::CmdAnswer(r) => (r.id, self.cmd_answer(caller, r.params)),
            R::SettingsGet(r) => (r.id, unsupported("settings.get")),
            R::SettingsSet(r) => (r.id, unsupported("settings.set")),
            R::SettingsList(r) => (r.id, unsupported("settings.list")),
            R::LogWrite(r) => (r.id, unsupported("log.write")),
            R::LogTail(r) => (r.id, unsupported("log.tail")),
            R::EventsSubscribe(r) => (r.id, self.events_subscribe(caller, r.params)),
            R::EventsUnsubscribe(r) => (r.id, self.events_unsubscribe(caller, r.params)),
            R::DataQuery(r) => (r.id, unsupported("data.query")),
            R::DataGet(r) => (r.id, unsupported("data.get")),
            R::DataSubscribe(r) => (r.id, unsupported("data.subscribe")),
            R::DataUnsubscribe(r) => (r.id, unsupported("data.unsubscribe")),
            R::ConnectorList(r) => (r.id, unsupported("connector.list")),
            R::ConnectorConnect(r) => (r.id, unsupported("connector.connect")),
            R::ConnectorDisconnect(r) => (r.id, unsupported("connector.disconnect")),
            R::ConnectorSyncNow(r) => (r.id, unsupported("connector.sync")),
            R::ViewList(r) => (r.id, unsupported("view.list")),
            R::ViewGet(r) => (r.id, unsupported("view.get")),
            R::ViewSave(r) => (r.id, unsupported("view.save")),
            R::ViewRemove(r) => (r.id, unsupported("view.remove")),
            R::CatalogGet(r) => (r.id, unsupported("catalog.get")),
        }
    }

    /// Check the scope against the caller's grants, then map the bridge path onto the file system.
    pub(crate) fn authorize(
        &self,
        caller: &str,
        scope: &Permission,
        path: &str,
    ) -> Result<PathBuf, BridgeError> {
        self.check(caller, scope, &Target::Path(path))?;
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
