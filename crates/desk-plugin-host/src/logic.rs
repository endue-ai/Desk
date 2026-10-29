//! The logic plugin host: one Wasmtime engine, one store and instance per plugin.

use std::collections::BTreeMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use desk_bridge::PluginManifest;
use wasmtime::component::{Component, HasSelf, Linker};
use wasmtime::{Config, Engine, Store, Trap};

use crate::bindings::{Error, Plugin};
use crate::host::Host;
use crate::imports::Imports;
use crate::limits::{Limits, Ticker};
use crate::manifest;
use crate::state::State;

/// Why a plugin could not be installed or did not run to the end.
#[derive(Debug, Clone, PartialEq)]
pub enum PluginError {
    /// The engine or linker could not be set up.
    Setup(String),
    /// plugin.json is missing or wrong, the plugin is not a logic plugin, or its entry cannot be read.
    Manifest(String),
    /// The entry is not a Wasm component Wasmtime can compile.
    Compile(String),
    /// The component imports something the host does not provide, or does not export `start`.
    Link(String),
    /// A call ran past the time limit.
    TimeLimit,
    /// The instance asked for more memory than the limit.
    MemoryLimit,
    /// The instance trapped.
    Trap(String),
    /// `start` returned an error of its own; the instance is still usable.
    Guest(Error),
    /// The instance trapped or ran out of limits before; reload the plugin to run it again.
    Crashed(String),
    /// No plugin with this id is installed.
    NotInstalled(String),
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
            Self::Guest(error) => write!(f, "{:?}: {}", error.code, error.message),
            Self::Crashed(why) => write!(f, "the plugin crashed earlier ({why}); reload it"),
            Self::NotInstalled(id) => write!(f, "no logic plugin {id} is installed"),
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
        let mut config = Config::new();
        config.wasm_component_model(true).epoch_interruption(true);
        let engine = Engine::new(&config).map_err(setup)?;
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
        let (manifest, bytes) = manifest::read(dir)?;
        let run = self.instantiate(&manifest, &bytes)?;
        let id = manifest.id;
        let dir = dir.to_path_buf();
        self.plugins.insert(id.clone(), Installed { dir, run });
        Ok(id)
    }

    /// Call the plugin's `start` export.
    pub fn start(&mut self, id: &str) -> Result<(), PluginError> {
        let ticks = self.limits.ticks();
        let installed = self.installed_mut(id)?;
        let Run::Ready { store, plugin } = &mut installed.run else {
            let Run::Crashed(why) = &installed.run else {
                unreachable!()
            };
            return Err(PluginError::Crashed(why.clone()));
        };
        store.set_epoch_deadline(ticks);
        match plugin.call_start(&mut **store) {
            Ok(Ok(())) => Ok(()),
            Ok(Err(error)) => Err(PluginError::Guest(error)),
            Err(trap) => {
                let error = stopped(&trap, store, PluginError::Trap);
                installed.run = Run::Crashed(error.to_string());
                Err(error)
            }
        }
    }

    /// Read the plugin's folder again, build a new instance from the new bytes and start it. The old
    /// instance is dropped; what the plugin keeps in the store is still there.
    pub fn reload(&mut self, id: &str) -> Result<(), PluginError> {
        let dir = self.installed_mut(id)?.dir.clone();
        let fresh = manifest::read(&dir).and_then(|(manifest, bytes)| {
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

    fn installed_mut(&mut self, id: &str) -> Result<&mut Installed, PluginError> {
        self.plugins
            .get_mut(id)
            .ok_or_else(|| PluginError::NotInstalled(id.to_owned()))
    }

    fn instantiate(&self, manifest: &PluginManifest, bytes: &[u8]) -> Result<Run, PluginError> {
        let component = Component::from_binary(&self.engine, bytes)
            .map_err(|e| PluginError::Compile(format!("{e:#}")))?;
        let imports = Imports::new(manifest, Arc::clone(&self.host));
        let mut store = Box::new(Store::new(&self.engine, State::new(imports, &self.limits)));
        store.limiter(|state| &mut state.limiter);
        store.epoch_deadline_trap();
        store.set_epoch_deadline(self.limits.ticks());
        match Plugin::instantiate(&mut *store, &component, &self.linker) {
            Ok(plugin) => Ok(Run::Ready { store, plugin }),
            Err(error) => Err(stopped(&error, &store, PluginError::Link)),
        }
    }
}

/// Name what stopped a call: a limit, or else `otherwise` with the error's text.
fn stopped(
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
