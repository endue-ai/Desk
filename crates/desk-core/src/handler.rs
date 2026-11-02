//! `Core::handle`: one bridge request in, one bridge response out. Every primitive call passes the
//! permission engine first (`Core::check`); methods the core does not serve yet answer `unsupported`.
//! The integration layer (`data.*`, `connector.*`, `view.*`, `catalog.get`) holds the item index
//! as `Arc<dyn ItemIndex>`, the OS calendar as a `CalendarSource` and one connector host.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex, MutexGuard};

use base64::Engine as _;
use desk_bridge::{
    BridgeError, BridgeFailure, BridgeRequest, BridgeResponse, BridgeSuccess, DirEntry, Encoding,
    EntryKind, ErrorCode, False, FsListResult, FsReadParams, FsReadResult, Permission, RequestId,
    True, UpdateParams,
};
use desk_index::ItemIndex;
use desk_plugin_host::{Clock, SystemClock, rfc3339};
use desk_sys::calendar::CalendarSource;
use desk_sys::fs as sysfs;
use desk_sys::shell::{Opener, SystemOpener};
use serde::Serialize;

use crate::conversation::Conversation;
use crate::core_cmd::Commands;
use crate::core_connectors::Connectors;
use crate::core_data::DataSubscriptions;
use crate::core_events::Subscriptions;
use crate::core_fs::{Watches, read_range};
use crate::core_fs_url::FileUrls;
use crate::core_perm::{Prompter, RefuseAll};
use crate::core_plugin_views::ProvidedViews;
use crate::core_proc::Processes;
use crate::core_prompts::Prompts;
use crate::core_ui::Surfaces;
use crate::core_views::ViewsSeen;
use crate::events::EventBus;
use crate::init::InitFile;
use crate::log::Log;
use crate::paths::normalize;
use crate::perm::{Denied, PermissionEngine, Target};
use crate::plugins::PluginRegistry;
use crate::secrets::Secrets;
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
    pub(crate) settings: Mutex<Store>,
    pub(crate) log: Mutex<Log>,
    pub(crate) conversation: Option<Arc<Conversation>>,
    pub(crate) init: Mutex<InitFile>,
    pub(crate) sync: Option<Syncer>,
    pub(crate) notifications: AtomicU64,
    pub(crate) watches: Mutex<Watches>,
    pub(crate) file_urls: Mutex<FileUrls>,
    pub(crate) commands: Mutex<Commands>,
    pub(crate) search_results: Mutex<crate::core_search::RecentResults>,
    pub(crate) index: Option<Arc<dyn ItemIndex>>,
    pub(crate) calendar: Option<Arc<dyn CalendarSource>>,
    pub(crate) clock: Arc<dyn Clock>,
    pub(crate) secrets: Mutex<Secrets>,
    pub(crate) data_subscriptions: Mutex<DataSubscriptions>,
    pub(crate) connectors: Connectors,
    pub(crate) views: Mutex<ViewsSeen>,
    pub(crate) processes: Arc<Mutex<Processes>>,
    pub(crate) provided_views: Mutex<ProvidedViews>,
    pub(crate) surfaces: Mutex<Surfaces>,
    pub(crate) opener: Box<dyn Opener>,
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
            settings: Mutex::new(Store::new(None)),
            log: Mutex::new(Log::default()),
            conversation: None,
            init: Mutex::new(InitFile::memory()),
            sync: None,
            notifications: AtomicU64::new(0),
            watches: Mutex::new(Watches::default()),
            file_urls: Mutex::new(FileUrls::default()),
            commands: Mutex::new(Commands::default()),
            search_results: Mutex::default(),
            index: None,
            calendar: None,
            clock: Arc::new(SystemClock),
            secrets: Mutex::new(Secrets::new(None)),
            data_subscriptions: Mutex::new(DataSubscriptions::default()),
            connectors: Connectors::default(),
            views: Mutex::new(ViewsSeen::default()),
            processes: Arc::new(Mutex::new(Processes::default())),
            provided_views: Mutex::new(ProvidedViews::default()),
            surfaces: Mutex::new(Surfaces::default()),
            opener: Box::new(SystemOpener),
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
                let FsReadParams {
                    path,
                    encoding,
                    offset,
                    length,
                    scope,
                } = r.params;
                let answer = self
                    .authorize(caller, &Permission::FsRead(scope), &path)
                    .and_then(|path| {
                        let encoding = encoding.unwrap_or(Encoding::Utf8);
                        read(&path, encoding, offset.unwrap_or(0), length)
                    });
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
            R::SearchReplace(r) => (r.id, self.search_replace(caller, r.params)),
            R::SearchQuery(r) => (r.id, self.search_query(caller, r.params)),
            R::SearchSystem(r) => (r.id, self.search_system(caller, r.params)),
            R::SearchOpen(r) => (r.id, self.search_open(caller, r.params)),
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
            R::FsUrl(r) => (r.id, self.fs_url(caller, r.params)),
            R::ProcSpawn(r) => (r.id, self.proc_spawn(caller, r.params)),
            R::ProcWrite(r) => (r.id, self.proc_write(caller, r.params)),
            R::ProcResize(r) => (r.id, self.proc_resize(caller, r.params)),
            R::ProcKill(r) => (r.id, self.proc_kill(caller, r.params)),
            R::NetFetch(r) => (r.id, self.net_fetch(caller, r.params)),
            R::AudioCaptureStart(r) => (r.id, unsupported("audio.capture.start")),
            R::AudioCaptureStop(r) => (r.id, unsupported("audio.capture.stop")),
            R::UiSurfaceOpen(r) => (r.id, self.surface_open(caller, r.params)),
            R::UiSurfaceClose(r) => (r.id, self.surface_close(caller, r.params)),
            R::CmdRegister(r) => (r.id, self.cmd_register(caller, r.params)),
            R::CmdUnregister(r) => (r.id, self.cmd_unregister(caller, r.params)),
            R::CmdList(r) => (r.id, self.cmd_list(caller, r.params)),
            R::CmdInvoke(r) => (r.id, self.cmd_invoke(caller, r.params)),
            R::CmdAnswer(r) => (r.id, self.cmd_answer(caller, r.params)),
            R::SettingsGet(r) => (r.id, self.settings_get(caller, r.params)),
            R::SettingsSet(r) => (r.id, self.settings_set(caller, r.params)),
            R::SettingsList(r) => (r.id, self.settings_list(caller, r.params)),
            R::LogWrite(r) => (r.id, self.log_write(caller, r.params)),
            R::LogTail(r) => (r.id, self.log_tail(caller, r.params)),
            R::EventsSubscribe(r) => (r.id, self.events_subscribe(caller, r.params)),
            R::EventsUnsubscribe(r) => (r.id, self.events_unsubscribe(caller, r.params)),
            R::DataQuery(r) => (r.id, self.data_query(caller, r.params)),
            R::DataGet(r) => (r.id, self.data_get(caller, r.params)),
            R::DataSubscribe(r) => (r.id, self.data_subscribe(caller, r.params)),
            R::DataUnsubscribe(r) => (r.id, self.data_unsubscribe(caller, r.params)),
            R::ConnectorList(r) => (r.id, self.connector_list(caller, r.params)),
            R::ConnectorConnect(r) => (r.id, self.connector_connect(caller, r.params)),
            R::ConnectorDisconnect(r) => (r.id, self.connector_disconnect(caller, r.params)),
            R::ConnectorSyncNow(r) => (r.id, self.connector_sync(caller, r.params)),
            R::ViewList(r) => (r.id, self.view_list(caller, r.params)),
            R::ViewGet(r) => (r.id, self.view_get(caller, r.params)),
            R::ViewSave(r) => (r.id, self.view_save(caller, r.params)),
            R::ViewRemove(r) => (r.id, self.view_remove(caller, r.params)),
            R::CatalogGet(r) => (r.id, self.catalog_get(caller)),
            R::ShellOpen(r) => (r.id, self.shell_open(caller, r.params)),
            R::UpdateStatus(r) => (
                r.id,
                self.update_unsupported(caller, r.params, "update.status"),
            ),
            R::UpdateCheck(r) => (
                r.id,
                self.update_unsupported(caller, r.params, "update.check"),
            ),
            R::UpdateDownload(r) => {
                let answer = self.update_unsupported(caller, r.params, "update.download");
                (r.id, answer)
            }
            R::UpdateApply(r) => (
                r.id,
                self.update_unsupported(caller, r.params, "update.apply"),
            ),
        }
    }

    /// update.* (ADR 0054) before the updater exists: the scope is checked like any call's, and then
    /// no build updates itself yet.
    fn update_unsupported(&self, caller: &str, params: UpdateParams, method: &str) -> Answer {
        self.check(
            caller,
            &Permission::UpdateManage(params.scope),
            &Target::None,
        )?;
        unsupported(method)
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

    /// A bridge path on the file system: `~` and `${home}` are the home folder.
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

    /// The home folder: `~` and `${home}`, and where a process starts unless its caller says where.
    pub(crate) fn home(&self) -> &Path {
        &self.roots.home
    }

    pub(crate) fn permissions(&self) -> MutexGuard<'_, PermissionEngine> {
        self.permissions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// fs.read: `length` bytes at most from `offset` (to the end without a length), with the file's size.
fn read(path: &Path, encoding: Encoding, offset: u64, length: Option<u64>) -> Answer {
    let (bytes, size) = read_range(path, offset, length).map_err(io_error)?;
    let content = match encoding {
        Encoding::Utf8 => String::from_utf8(bytes).map_err(|_| {
            let what = if offset == 0 && length.is_none() {
                "the file is"
            } else {
                "the range is"
            };
            error(
                ErrorCode::InvalidParams,
                format!("{what} not UTF-8; read it as base64"),
            )
        })?,
        Encoding::Base64 => base64::engine::general_purpose::STANDARD.encode(bytes),
    };
    json(FsReadResult {
        content,
        encoding,
        size: Some(size),
    })
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
            modified_at: entry.modified.map(rfc3339),
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

/// A primitive's error, whose code is already the bridge's.
pub(crate) fn sys_error(err: desk_sys::Error) -> BridgeError {
    error(err.code, err.message)
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
