//! The logic plugin host: one Wasmtime engine, one store and instance per plugin.

use std::collections::BTreeMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use desk_bridge::{PluginKind, PluginManifest};
use serde_json::Value;
use wasmtime::component::{Component, HasSelf, Linker};
use wasmtime::{Engine, Store, Trap};

use crate::bindings::{Error, ErrorCode, Plugin};
use crate::host::Host;
use crate::imports::Imports;
use crate::limits::{Limits, Ticker};
use crate::manifest;
use crate::state::{self, State};

/// Why a plugin could not be installed or did not run to the end.
#[derive(Debug, Clone, PartialEq)]
pub enum PluginError {
    /// The engine or linker could not be set up.
    Setup(String),
    /// plugin.json is missing or wrong, the plugin is not of the kind (or binding) the host runs,
    /// or its entry cannot be read.
    Manifest(String),
    /// The entry is not a Wasm component Wasmtime can compile.
    Compile(String),
    /// The component imports something the host does not provide, or lacks one of the world's
    /// exports (`start`, `on-command`, `on-event`; for a connector `sync`, `query`, `act`, `status`).
    Link(String),
    /// A call ran past the time limit.
    TimeLimit,
    /// The instance asked for more memory than the limit.
    MemoryLimit,
    /// The instance trapped.
    Trap(String),
    /// An export returned an error of its own; the instance is still usable.
    Guest(Error),
    /// The instance trapped or ran out of limits before; reload the plugin to run it again.
    Crashed(String),
    /// No plugin with this id is installed.
    NotInstalled(String),
    /// The connector has no instance by this name (`<connector>/<instance>`).
    NoInstance(String),
    /// The instance (`<connector>/<instance>`) is paused; resume it to sync.
    Paused(String),
    /// The host itself refused: settings that do not fit, an item that does not, an action the
    /// manifest does not declare, the index sink, an instance that already exists.
    Host(Error),
}

impl fmt::Display for PluginError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Setup(why) => write!(f, "the plugin host cannot start: {why}"),
            Self::Manifest(why) => write!(f, "{why}"),
            Self::Compile(why) => write!(f, "the entry is not a usable component: {why}"),
            Self::Link(why) => write!(f, "the component does not fit desk:host: {why}"),
            Self::TimeLimit => write!(f, "the plugin ran past its time limit"),
            Self::MemoryLimit => write!(f, "the plugin asked for more memory than its limit"),
            Self::Trap(why) => write!(f, "the plugin trapped: {why}"),
            Self::Guest(error) => write!(f, "{}: {}", code_name(error.code), error.message),
            Self::Crashed(why) => write!(f, "the plugin crashed earlier ({why}); reload it"),
            Self::NotInstalled(id) => write!(f, "no plugin {id} is installed"),
            Self::NoInstance(name) => write!(f, "there is no instance {name}"),
            Self::Paused(name) => write!(f, "{name} is paused"),
            Self::Host(error) => write!(f, "{}: {}", code_name(error.code), error.message),
        }
    }
}

impl std::error::Error for PluginError {}

struct Installed {
    dir: PathBuf,
    run: Run,
}

enum Run {
    Ready {
        store: Box<Store<State>>,
        plugin: Plugin,
    },
    Crashed(String),
}

/// Runs logic plugins as Wasm components. Each plugin gets its own store, so a trap or a limit in
/// one never reaches another. Plugin state that must outlive an instance lives in the `Host` store.
pub struct LogicHost {
    engine: Engine,
    linker: Linker<State>,
    host: Arc<dyn Host>,
    limits: Limits,
    plugins: BTreeMap<String, Installed>,
    _ticker: Ticker,
}

impl LogicHost {
    pub fn new(host: Arc<dyn Host>, limits: Limits) -> Result<Self, PluginError> {
        let setup = |e: wasmtime::Error| PluginError::Setup(format!("{e:#}"));
        let engine = state::engine().map_err(setup)?;
        let mut linker = Linker::new(&engine);
        wasmtime_wasi::p2::add_to_linker_sync(&mut linker).map_err(setup)?;
        Plugin::add_to_linker::<State, HasSelf<State>>(&mut linker, |state| state)
            .map_err(setup)?;
        Ok(Self {
            _ticker: Ticker::start(engine.clone()),
            engine,
            linker,
            host,
            limits,
            plugins: BTreeMap::new(),
        })
    }

    /// Install the logic plugin in `dir` and instantiate it, without starting it. Returns its id.
    /// Installing an id again replaces the plugin.
    pub fn install(&mut self, dir: &Path) -> Result<String, PluginError> {
        let (manifest, bytes) = manifest::read(dir, PluginKind::Logic)?;
        let run = self.instantiate(&manifest, &bytes)?;
        let id = manifest.id;
        let dir = dir.to_path_buf();
        self.plugins.insert(id.clone(), Installed { dir, run });
        Ok(id)
    }

    /// Call the plugin's `start` export.
    pub fn start(&mut self, id: &str) -> Result<(), PluginError> {
        self.call(id, |plugin, store| plugin.call_start(store))
    }

    /// Deliver one invocation of a command the plugin provides to its `on-command` export, which
    /// answers through `cmd.answer`. `args` reach the guest as JSON text, `{}` when they are null.
    /// Which invocations are the plugin's own is the caller's to decide.
    pub fn deliver_command(
        &mut self,
        id: &str,
        invocation_id: &str,
        command_id: &str,
        args: &Value,
    ) -> Result<(), PluginError> {
        let args = if args.is_null() {
            "{}".to_owned()
        } else {
            args.to_string()
        };
        self.call(id, |plugin, store| {
            plugin.call_on_command(store, invocation_id, command_id, &args)
        })
    }

    /// Deliver one event to the plugin's `on-event` export; `data` reaches the guest as JSON text.
    /// Which events the plugin hears is the caller's to decide.
    pub fn deliver_event(&mut self, id: &str, name: &str, data: &Value) -> Result<(), PluginError> {
        let data = data.to_string();
        self.call(id, |plugin, store| plugin.call_on_event(store, name, &data))
    }

    /// Read the plugin's folder again, build a new instance from the new bytes and start it. The old
    /// instance is dropped; what the plugin keeps in the store is still there.
    pub fn reload(&mut self, id: &str) -> Result<(), PluginError> {
        let dir = self.installed_mut(id)?.dir.clone();
        let fresh = manifest::read(&dir, PluginKind::Logic).and_then(|(manifest, bytes)| {
            if manifest.id != id {
                let renamed = format!("plugin.json now says {}, not {id}", manifest.id);
                return Err(PluginError::Manifest(renamed));
            }
            self.instantiate(&manifest, &bytes)
        });
        let installed = self.installed_mut(id)?;
        match fresh {
            Ok(run) => installed.run = run,
            Err(error) => {
                installed.run = Run::Crashed(error.to_string());
                return Err(error);
            }
        }
        self.start(id)
    }

    /// Drop the plugin and its instance. Returns whether it was installed.
    pub fn remove(&mut self, id: &str) -> bool {
        self.plugins.remove(id).is_some()
    }

    /// The installed plugins' ids, sorted.
    pub fn installed(&self) -> Vec<String> {
        self.plugins.keys().cloned().collect()
    }

    /// Call one export under the time limit. An error the guest returns leaves the instance
    /// usable; a trap or a limit marks the plugin crashed until it is reloaded.
    fn call(
        &mut self,
        id: &str,
        export: impl FnOnce(&Plugin, &mut Store<State>) -> wasmtime::Result<Result<(), Error>>,
    ) -> Result<(), PluginError> {
        let ticks = self.limits.ticks();
        let installed = self.installed_mut(id)?;
        let (store, plugin) = match &mut installed.run {
            Run::Ready { store, plugin } => (store, plugin),
            Run::Crashed(why) => return Err(PluginError::Crashed(why.clone())),
        };
        store.set_epoch_deadline(ticks);
        match export(plugin, store) {
            Ok(Ok(())) => Ok(()),
            Ok(Err(error)) => Err(PluginError::Guest(error)),
            Err(trap) => {
                let error = stopped(&trap, store, PluginError::Trap);
                installed.run = Run::Crashed(error.to_string());
                Err(error)
            }
        }
    }

    fn installed_mut(&mut self, id: &str) -> Result<&mut Installed, PluginError> {
        self.plugins
            .get_mut(id)
            .ok_or_else(|| PluginError::NotInstalled(id.to_owned()))
    }

    fn instantiate(&self, manifest: &PluginManifest, bytes: &[u8]) -> Result<Run, PluginError> {
        let component = Component::from_binary(&self.engine, bytes)
            .map_err(|e| PluginError::Compile(format!("{e:#}")))?;
        let imports = Imports::new(manifest, Arc::clone(&self.host));
        let mut store = state::store(&self.engine, imports, &self.limits);
        match Plugin::instantiate(&mut *store, &component, &self.linker) {
            Ok(plugin) => Ok(Run::Ready { store, plugin }),
            Err(error) => Err(stopped(&error, &store, PluginError::Link)),
        }
    }
}

/// The WIT name of an error code: `not-found`, `invalid-params`.
pub(crate) fn code_name(code: ErrorCode) -> &'static str {
    match code {
        ErrorCode::PermissionDenied => "permission-denied",
        ErrorCode::InvalidParams => "invalid-params",
        ErrorCode::NotFound => "not-found",
        ErrorCode::AlreadyExists => "already-exists",
        ErrorCode::IoError => "io-error",
        ErrorCode::Timeout => "timeout",
        ErrorCode::Cancelled => "cancelled",
        ErrorCode::Unsupported => "unsupported",
        ErrorCode::Internal => "internal",
    }
}

/// Name what stopped a call: a limit, or else `otherwise` with the error's text.
pub(crate) fn stopped(
    error: &wasmtime::Error,
    store: &Store<State>,
    otherwise: fn(String) -> PluginError,
) -> PluginError {
    if store.data().limiter.exceeded {
        PluginError::MemoryLimit
    } else if error.downcast_ref::<Trap>() == Some(&Trap::Interrupt) {
        PluginError::TimeLimit
    } else {
        otherwise(format!("{error:#}"))
    }
}
