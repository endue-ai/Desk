//! `Core::handle`: one bridge request in, one bridge response out. Every primitive call passes the
//! permission engine first (`Core::check`); methods the core does not serve yet answer `unsupported`.
//! The integration layer (`data.*`, `connector.*`, `view.*`, `catalog.get`) holds the item index
//! as `Arc<dyn ItemIndex>`, the OS calendar as a `CalendarSource` and one connector host.

use std::collections::BTreeSet;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex, MutexGuard};

use desk_bridge::{
    BridgeError, BridgeFailure, BridgeRequest, BridgeResponse, BridgeSuccess, ErrorCode, False,
    Permission, True,
};
use desk_index::ItemIndex;
use desk_plugin_host::{Clock, SystemClock};
use desk_sys::calendar::CalendarSource;
use desk_sys::shell::{Opener, SystemOpener};
use serde::Serialize;

use crate::approvals::Approvals;
use crate::conversation::Conversation;
use crate::core_cmd::Commands;
use crate::core_connectors::Connectors;
use crate::core_data::DataSubscriptions;
use crate::core_events::Subscriptions;
use crate::core_fs::Watches;
use crate::core_fs_url::FileUrls;
use crate::core_perm::{Prompter, RefuseAll};
use crate::core_plugin_views::ProvidedViews;
use crate::core_proc::Processes;
use crate::core_prompts::Prompts;
use crate::core_recent::Recent;
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
    pub(crate) approvals: Mutex<Approvals>,
    pub(crate) subscriptions: Mutex<Subscriptions>,
    pub(crate) plugins: Mutex<PluginRegistry>,
    /// plugins.lock: its path, the digests it pins, the text last written (ADR 0079).
    pub(crate) plugins_lock: Mutex<crate::core_lock::LockState>,
    /// The market for every kind: where its installs land, the endue index (ADR 0107).
    pub(crate) market: crate::core_marketplace::Market,
    pub(crate) store: Mutex<Store>,
    pub(crate) settings: Mutex<Store>,
    /// The settings problems logged so far (ADR 0080), so each is logged once.
    pub(crate) settings_reported: Mutex<BTreeSet<String>>,
    pub(crate) log: Mutex<Log>,
    pub(crate) conversation: Option<Arc<Conversation>>,
    /// The brains the runtime's setting chooses from (ADR 0094), when the desk has more than one.
    pub(crate) choice: Option<Arc<crate::brain_choice::BrainChoice>>,
    /// Eris's memory (ADR 0095), when the desk keeps one.
    pub(crate) memory: Option<Arc<desk_memory::Memory>>,
    pub(crate) init: Mutex<InitFile>,
    pub(crate) sync: Option<Syncer>,
    pub(crate) notifications: AtomicU64,
    pub(crate) watches: Mutex<Watches>,
    pub(crate) trash: crate::core_fs::TrashFn,
    pub(crate) history: Mutex<Option<crate::history::History>>,
    pub(crate) undo: Mutex<crate::core_undo::Stacks>,
    pub(crate) file_urls: Mutex<FileUrls>,
    pub(crate) commands: Mutex<Commands>,
    pub(crate) runs: Mutex<crate::agent_runs::Runs>,
    pub(crate) recent: Mutex<Recent>,
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
    pub(crate) updater: Option<desk_update::Updater>,
    pub(crate) account: Option<Arc<crate::account::Account>>,
    pub(crate) local_agents: Option<Arc<crate::local_agents::LocalAgents>>,
    /// endue AI's platform for studio.* (ADR 0122): the one given, or one over the account's token.
    pub(crate) studio: crate::studio::Studio,
    /// The computer (ADR 0123): the injected driver, its stop flag and the screenshots' folder.
    pub(crate) computer: crate::computer::Seat,
    pub(crate) themes: crate::core_themes::Themes,
    pub(crate) start: Mutex<crate::core_state::StartState>,
}

impl Core {
    pub fn new(roots: Roots) -> Self {
        Self {
            roots,
            permissions: Mutex::new(PermissionEngine::new()),
            events: EventBus::new(),
            prompter: Box::new(RefuseAll),
            prompts: Mutex::new(Prompts::default()),
            approvals: Mutex::default(),
            subscriptions: Mutex::new(Subscriptions::default()),
            plugins: Mutex::new(PluginRegistry::new(None)),
            plugins_lock: Mutex::default(),
            market: Default::default(),
            store: Mutex::new(Store::new(None)),
            settings: Mutex::new(Store::new(None)),
            settings_reported: Mutex::default(),
            log: Mutex::new(Log::default()),
            conversation: None,
            choice: None,
            memory: None,
            init: Mutex::new(InitFile::memory()),
            sync: None,
            notifications: AtomicU64::new(0),
            watches: Mutex::new(Watches::default()),
            trash: crate::core_fs::system_trash(),
            history: Mutex::new(None),
            undo: Mutex::default(),
            file_urls: Mutex::new(FileUrls::default()),
            commands: Mutex::new(Commands::default()),
            runs: Mutex::default(),
            recent: Mutex::default(),
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
            updater: None,
            account: None,
            local_agents: None,
            studio: Default::default(),
            computer: Default::default(),
            themes: Default::default(),
            start: Mutex::default(),
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
        self.report_approved(&answer);
        self.count_call(caller, answer.is_ok());
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

pub(crate) fn unsupported(method: &str) -> Answer {
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
