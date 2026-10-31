//! The connector side of `Core`: connector.list, connect, disconnect and sync under
//! `connector:manage`, over the built-in connectors (`core_builtins`) and the connector host for
//! Wasm connectors (`core_wasm`). Every status change reaches the `connector:manage` holders as
//! `connector.changed`, once. One scheduler thread ticks both (`tick_connectors`); tests tick
//! themselves. The core never holds a lock of its own across a connector host call: the host calls
//! back into it.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, Weak};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use desk_bridge::{
    BridgeError, BridgeEvent, ConnectorChange, ConnectorChangedData, ConnectorChangedEvent,
    ConnectorConnectParams, ConnectorDisconnectParams, ConnectorInstance, ConnectorListParams,
    ConnectorListResult, ConnectorManagePermission, ConnectorState, ConnectorStatus,
    ConnectorSyncNowParams, ErrorCode, Permission,
};
use desk_plugin_host::{Clock, ConnectorHost, PluginError};
use desk_sys::calendar::CalendarSource;
use serde_json::{Map, Value};

use crate::core_builtins::BuiltIns;
use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;
use crate::secrets::Secrets;

/// The store key of a connector's instance records, the connector host's.
pub(crate) const INSTANCES: &str = "desk.connector/instances";
/// The store key of the titles people gave a connector's instances, by instance id.
pub(crate) const TITLES: &str = "desk.connector/titles";

/// What the core keeps for connectors.
#[derive(Default)]
pub(crate) struct Connectors {
    /// The core itself, once shared: what the connector host calls back into.
    pub(crate) me: OnceLock<Weak<Core>>,
    /// Made when the first Wasm connector is installed.
    pub(crate) host: Mutex<Option<Arc<ConnectorHost>>>,
    pub(crate) builtins: Mutex<BuiltIns>,
    feed: Mutex<Feed>,
    scheduler: Mutex<Option<Scheduler>>,
}

/// Status changes on their way to `connector.changed`: the last one sent per instance, so none
/// goes twice, and the instances being connected, whose host changes `connected` stands for.
#[derive(Default)]
pub(crate) struct Feed {
    pub(crate) host: Option<Receiver<ConnectorInstance>>,
    last: BTreeMap<(String, String), ConnectorStatus>,
    connecting: BTreeSet<(String, String)>,
}

impl Core {
    /// Read the OS calendar through `source` (desk-sys `calendar::os()` on macOS), which makes the
    /// built-in connectors `desk.calendar` and `desk.reminders`.
    pub fn with_calendar(mut self, source: Arc<dyn CalendarSource>) -> Self {
        self.calendar = Some(source);
        self
    }

    /// Tell time for syncs from `clock` (`SystemClock` by default; a fake one in tests).
    pub fn with_clock(mut self, clock: Arc<dyn Clock>) -> Self {
        self.clock = clock;
        self
    }

    /// Keep connector secrets in `path` (`secrets.json` in the data folder; ADR 0036).
    pub fn with_secrets_file(self, path: PathBuf) -> Self {
        *self.lock_secrets() = Secrets::new(Some(path));
        self
    }

    /// Start the connectors once the core is shared: the built-ins' instances from their records,
    /// and every ready Wasm connector plugin into the connector host. Plugins installed later go
    /// in as they install. Nothing asks the OS here.
    pub fn start_connectors(self: &Arc<Self>) {
        let _ = self.connectors.me.set(Arc::downgrade(self));
        self.load_builtins();
        for info in self.plugins() {
            self.install_connector(&info);
        }
        self.drain_statuses();
    }

    /// Run every sync that is due, built-in and Wasm, on this thread. Returns the (connector,
    /// instance) pairs it ran.
    pub fn tick_connectors(&self) -> Vec<(String, String)> {
        let mut ran = self.tick_builtins();
        if let Some(host) = self.connector_host() {
            ran.extend(host.tick());
        }
        self.drain_statuses();
        ran
    }

    /// Tick every `period` on the thread `desk-connector-scheduler` while the core lives (1 s in
    /// the app). Starting it again replaces the thread.
    pub fn start_connector_scheduler(self: &Arc<Self>, period: Duration) {
        let scheduler = Scheduler::start(Arc::downgrade(self), period);
        let old = self.lock_scheduler().replace(scheduler);
        drop(old);
    }

    pub(crate) fn connector_list(&self, caller: &str, params: ConnectorListParams) -> Answer {
        self.check_manage(caller, params.scope)?;
        let mut connectors = self.builtin_infos();
        connectors.extend(self.plugin_connector_infos());
        connectors.sort_by(|a, b| a.id.cmp(&b.id));
        json(ConnectorListResult { connectors })
    }

    pub(crate) fn connector_connect(&self, caller: &str, params: ConnectorConnectParams) -> Answer {
        self.check_manage(caller, params.scope.clone())?;
        if self.is_builtin(&params.connector) {
            return self.connect_builtin(params);
        }
        self.connect_wasm(params)
    }

    pub(crate) fn connector_disconnect(
        &self,
        caller: &str,
        params: ConnectorDisconnectParams,
    ) -> Answer {
        self.check_manage(caller, params.scope)?;
        let (id, instance) = (params.connector.as_str(), params.instance.as_str());
        if self.is_builtin(id) {
            return self.disconnect_builtin(id, instance);
        }
        self.disconnect_wasm(id, instance)
    }

    pub(crate) fn connector_sync(&self, caller: &str, params: ConnectorSyncNowParams) -> Answer {
        self.check_manage(caller, params.scope)?;
        let (id, instance) = (params.connector.as_str(), params.instance.as_str());
        if self.is_builtin(id) {
            return self.sync_builtin_now(id, instance);
        }
        self.sync_wasm(id, instance)
    }

    /// A status change of one instance: `connector.changed` `updated`, unless it was the last one
    /// sent or the instance is still being connected.
    pub(crate) fn report(&self, connector: &str, instance: &str, status: ConnectorStatus) {
        let mut feed = self.feed();
        self.report_locked(&mut feed, connector, instance, status);
    }

    /// Send what the connector host reported since the last drain.
    pub(crate) fn drain_statuses(&self) {
        let mut feed = self.feed();
        let changes: Vec<ConnectorInstance> = match &feed.host {
            Some(host) => std::iter::from_fn(|| host.try_recv().ok()).collect(),
            None => Vec::new(),
        };
        for change in changes {
            self.report_locked(
                &mut feed,
                &change.connector,
                &change.instance,
                change.status,
            );
        }
    }

    /// The host's changes for this instance wait until `announce_connected`.
    pub(crate) fn connecting(&self, connector: &str, instance: &str) {
        let key = (connector.to_owned(), instance.to_owned());
        self.feed().connecting.insert(key);
    }

    /// A new instance: `connector.changed` `connected` with its status.
    pub(crate) fn announce_connected(
        &self,
        connector: &str,
        instance: &str,
        status: ConnectorStatus,
    ) {
        let mut feed = self.feed();
        let key = (connector.to_owned(), instance.to_owned());
        feed.connecting.remove(&key);
        feed.last.insert(key, status.clone());
        self.connector_changed(
            connector,
            instance,
            ConnectorChange::Connected,
            Some(status),
        );
    }

    /// The connect failed: the host's changes for the instance count again.
    pub(crate) fn connect_failed(&self, connector: &str, instance: &str) {
        let key = (connector.to_owned(), instance.to_owned());
        self.feed().connecting.remove(&key);
    }

    /// A removed instance: `connector.changed` `disconnected`, without a status.
    pub(crate) fn announce_disconnected(&self, connector: &str, instance: &str) {
        let mut feed = self.feed();
        feed.last
            .remove(&(connector.to_owned(), instance.to_owned()));
        self.connector_changed(connector, instance, ConnectorChange::Disconnected, None);
    }

    /// The title the person gave an instance, from the connector's store.
    pub(crate) fn title(&self, connector: &str, instance: &str) -> Option<String> {
        let titles = self.stored(connector, TITLES)?;
        titles.get(instance)?.as_str().map(str::to_owned)
    }

    /// Keep (or with `None`, forget) an instance's title in the connector's store.
    pub(crate) fn set_title(&self, connector: &str, instance: &str, title: Option<String>) {
        let mut titles = match self.stored(connector, TITLES) {
            Some(Value::Object(titles)) => titles,
            _ => Map::new(),
        };
        let changed = match title {
            Some(title) => {
                titles.insert(instance.to_owned(), Value::String(title));
                true
            }
            None => titles.remove(instance).is_some(),
        };
        if changed {
            // A refused write leaves the title out of this listing; the instance stands.
            let _ = self.store_put(connector, TITLES, Value::Object(titles));
        }
    }

    fn report_locked(
        &self,
        feed: &mut Feed,
        connector: &str,
        instance: &str,
        status: ConnectorStatus,
    ) {
        let key = (connector.to_owned(), instance.to_owned());
        if feed.connecting.contains(&key) || feed.last.get(&key) == Some(&status) {
            return;
        }
        feed.last.insert(key, status.clone());
        self.connector_changed(connector, instance, ConnectorChange::Updated, Some(status));
    }

    /// `connector.changed` for the connector:manage holders.
    fn connector_changed(
        &self,
        connector: &str,
        instance: &str,
        change: ConnectorChange,
        status: Option<ConnectorStatus>,
    ) {
        let to = self.holders(&connector_manage());
        let data = ConnectorChangedData {
            connector: connector.to_owned(),
            instance: instance.to_owned(),
            change,
            status,
        };
        let event = BridgeEvent::ConnectorChanged(ConnectorChangedEvent {
            event: Default::default(),
            data,
        });
        self.events().publish_to(to, event);
    }

    fn check_manage(
        &self,
        caller: &str,
        scope: ConnectorManagePermission,
    ) -> Result<(), BridgeError> {
        self.check(caller, &Permission::ConnectorManage(scope), &Target::None)
    }

    pub(crate) fn feed(&self) -> MutexGuard<'_, Feed> {
        self.connectors
            .feed
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(crate) fn lock_secrets(&self) -> MutexGuard<'_, Secrets> {
        self.secrets
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lock_scheduler(&self) -> MutexGuard<'_, Option<Scheduler>> {
        self.connectors
            .scheduler
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// The connector:manage scope.
pub(crate) fn connector_manage() -> Permission {
    Permission::ConnectorManage(ConnectorManagePermission {
        permission: Default::default(),
    })
}

/// A status in `state`, with the last sync and an error message when there is one.
pub(crate) fn status(
    state: ConnectorState,
    last_sync_at: Option<String>,
    message: Option<String>,
) -> ConnectorStatus {
    let error = message.map(|message| desk_bridge::ConnectorError {
        message,
        reauth: None,
    });
    ConnectorStatus {
        state,
        last_sync_at,
        error,
    }
}

/// A connector host failure as a bridge error.
pub(crate) fn plugin_error(failure: PluginError) -> BridgeError {
    use desk_plugin_host::ErrorCode as Wit;
    let code = |code: Wit| match code {
        Wit::PermissionDenied => ErrorCode::PermissionDenied,
        Wit::InvalidParams => ErrorCode::InvalidParams,
        Wit::NotFound => ErrorCode::NotFound,
        Wit::AlreadyExists => ErrorCode::AlreadyExists,
        Wit::IoError => ErrorCode::IoError,
        Wit::Timeout => ErrorCode::Timeout,
        Wit::Cancelled => ErrorCode::Cancelled,
        Wit::Unsupported => ErrorCode::Unsupported,
        Wit::Internal => ErrorCode::Internal,
    };
    match failure {
        PluginError::Host(e) | PluginError::Guest(e) => error(code(e.code), e.message),
        PluginError::NotInstalled(_) | PluginError::NoInstance(_) => {
            error(ErrorCode::NotFound, failure.to_string())
        }
        PluginError::Paused(_) => error(ErrorCode::InvalidParams, failure.to_string()),
        other => error(ErrorCode::Internal, other.to_string()),
    }
}

/// The thread that ticks every connector until it is dropped, or until the core is gone.
struct Scheduler {
    stop: Option<Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

impl Scheduler {
    fn start(core: Weak<Core>, period: Duration) -> Self {
        let (stop, stopped) = mpsc::channel::<()>();
        let thread = thread::Builder::new()
            .name("desk-connector-scheduler".into())
            .spawn(move || {
                while let Err(RecvTimeoutError::Timeout) = stopped.recv_timeout(period) {
                    let Some(core) = core.upgrade() else { break };
                    core.tick_connectors();
                }
            })
            .ok();
        Self {
            stop: Some(stop),
            thread,
        }
    }
}

impl Drop for Scheduler {
    fn drop(&mut self) {
        drop(self.stop.take());
        if let Some(thread) = self.thread.take() {
            // The core can go last on this thread itself, mid-tick: it must not wait for itself.
            if thread.thread().id() != thread::current().id() {
                let _ = thread.join();
            }
        }
    }
}
