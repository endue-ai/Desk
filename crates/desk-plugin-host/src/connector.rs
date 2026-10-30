//! The connector host: plugins of kind `connector` with `binding: wasm`, components of the
//! `desk:connector/connector` world (specs/wit). One engine and epoch thread per host, one store per
//! connector shared by its instances, and every sync's changes handed to an `IndexSink`.

mod convert;
mod instances;
mod schedule;
mod shared;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use desk_bridge::{ConnectorInstance, ConnectorManifest, ConnectorState, ConnectorStatus};
use desk_bridge::{ItemPage, ItemQuery, PluginManifest};
use serde_json::Value;
use wasmtime::Store;
use wasmtime::component::{HasSelf, Linker};

use crate::bindings::{Error, ErrorCode};
use crate::clock::Clock;
use crate::connector_bindings::Connector;
use crate::host::Host;
use crate::limits::{Limits, Ticker};
use crate::logic::PluginError;
use crate::sink::IndexSink;
use crate::state::{self, State};
use instances::{INSTANCES, Instance, cursor_key, invalid};
use schedule::Scheduler;
use shared::{crashes, failure, listing, lock, read, source};

/// Runs Wasm connectors. Instances and their cursors live in each connector's own store on the
/// `Host` (`desk.connector/…`, keys guests cannot reach), so a new host on the same desk finds them
/// again. Methods take `&self`; one lock serialises the calls into guests.
pub struct ConnectorHost {
    shared: Arc<Shared>,
    scheduler: Mutex<Option<Scheduler>>,
}

struct Shared {
    engine: wasmtime::Engine,
    linker: Linker<State>,
    host: Arc<dyn Host>,
    sink: Arc<dyn IndexSink>,
    clock: Arc<dyn Clock>,
    limits: Limits,
    plugins: Mutex<BTreeMap<String, Installed>>,
    watchers: Mutex<Vec<Sender<ConnectorInstance>>>,
    _ticker: Ticker,
}

struct Installed {
    dir: PathBuf,
    manifest: PluginManifest,
    connector: ConnectorManifest,
    run: Run,
    instances: BTreeMap<String, Instance>,
}

enum Run {
    Ready {
        store: Box<Store<State>>,
        guest: Connector,
    },
    Crashed(String),
}

impl ConnectorHost {
    /// A host with its own engine and epoch thread. `sink` takes what connectors bring in; `clock`
    /// says when syncs are due; `limits` apply to every call, as for logic plugins.
    pub fn new(
        host: Arc<dyn Host>,
        sink: Arc<dyn IndexSink>,
        clock: Arc<dyn Clock>,
        limits: Limits,
    ) -> Result<Self, PluginError> {
        let setup = |e: wasmtime::Error| PluginError::Setup(format!("{e:#}"));
        let engine = state::engine().map_err(setup)?;
        let mut linker = Linker::new(&engine);
        wasmtime_wasi::p2::add_to_linker_sync(&mut linker).map_err(setup)?;
        Connector::add_to_linker::<State, HasSelf<State>>(&mut linker, |state| state)
            .map_err(setup)?;
        let shared = Shared {
            _ticker: Ticker::start(engine.clone()),
            engine,
            linker,
            host,
            sink,
            clock,
            limits,
            plugins: Mutex::default(),
            watchers: Mutex::default(),
        };
        let scheduler = Mutex::new(None);
        Ok(Self {
            shared: Arc::new(shared),
            scheduler,
        })
    }

    /// Install the connector in `dir`, instantiate it, and load its instances from its store.
    /// Installing an id again replaces the connector. Returns its id.
    pub fn install(&self, dir: &Path) -> Result<String, PluginError> {
        let (manifest, connector, bytes) = read(dir)?;
        let shared = &self.shared;
        let run = shared.instantiate(&manifest, &bytes)?;
        let id = manifest.id.clone();
        let stored = shared.host.store_get(&id, INSTANCES);
        let now = shared.clock.now();
        // Loaded instances sync at the next tick, and are stale past two intervals without one.
        let every = schedule::interval(&connector.sync);
        let (stale_after, due) = (every.map(|e| e * 2), every.map(|_| now));
        let stored = stored.map_err(PluginError::Host)?;
        let instances = instances::load(stored, now, stale_after, due);
        let dir = dir.to_path_buf();
        let installed = Installed {
            dir,
            manifest,
            connector,
            run,
            instances,
        };
        lock(&shared.plugins).insert(id.clone(), installed);
        Ok(id)
    }

    /// Read the connector's folder again and build a new instance from it; its instances sync at
    /// the next tick. A trapped connector runs again only after this.
    pub fn reload(&self, id: &str) -> Result<(), PluginError> {
        let shared = &self.shared;
        shared.with(id, |installed| {
            let fresh = read(&installed.dir).and_then(|(manifest, connector, bytes)| {
                if manifest.id != id {
                    let renamed = format!("plugin.json now says {}, not {id}", manifest.id);
                    return Err(PluginError::Manifest(renamed));
                }
                let run = shared.instantiate(&manifest, &bytes)?;
                Ok((manifest, connector, run))
            });
            let (manifest, connector, run) = fresh.inspect_err(|error| {
                installed.run = Run::Crashed(error.to_string());
                shared.crash_all(id, installed, &error.to_string());
            })?;
            let due = schedule::interval(&connector.sync).map(|_| shared.clock.now());
            (installed.manifest, installed.connector, installed.run) = (manifest, connector, run);
            for instance in installed.instances.values_mut() {
                (instance.due, instance.failures) = (due, 0);
            }
            Ok(())
        })
    }

    /// Drop the connector and its instance. Its instances stay in its store, so installing it
    /// again brings them back. Returns whether it was installed.
    pub fn remove(&self, id: &str) -> bool {
        lock(&self.shared.plugins).remove(id).is_some()
    }

    /// The installed connectors' ids, sorted.
    pub fn installed(&self) -> Vec<String> {
        lock(&self.shared.plugins).keys().cloned().collect()
    }

    /// Add the instance `name` with `settings`, checked against the manifest's `instanceSettings`;
    /// secret ones are never stored. Asks the guest's `status`: ok is `connected`, an error
    /// `error` (the instance stays). It syncs at the next tick.
    pub fn create_instance(
        &self,
        id: &str,
        name: &str,
        settings: Value,
    ) -> Result<ConnectorStatus, PluginError> {
        let shared = &self.shared;
        shared.with(id, |installed| {
            instances::check_id(name).map_err(PluginError::Host)?;
            if installed.instances.contains_key(name) {
                let message = format!("{id}/{name} already exists");
                let code = ErrorCode::AlreadyExists;
                return Err(PluginError::Host(Error { code, message }));
            }
            let declared = installed.connector.instance_settings.as_ref();
            let settings = instances::check_settings(declared, &settings);
            let due = schedule::interval(&installed.connector.sync).map(|_| shared.clock.now());
            let instance = Instance::new(settings.map_err(PluginError::Host)?, due);
            installed.instances.insert(name.to_owned(), instance);
            if let Err(error) = shared.persist(id, installed) {
                installed.instances.remove(name);
                return Err(PluginError::Host(error));
            }
            let guest = installed.guest(id, name)?;
            let answer = shared.call(id, installed, |c, store| c.call_status(store, &guest));
            Ok(match answer {
                Ok(()) => shared.set(id, name, installed, ConnectorState::Connected, None),
                Err(error) if crashes(&error) => installed.instance(id, name)?.status.clone(),
                Err(error) => {
                    let message = Some(failure(&error));
                    shared.set(id, name, installed, ConnectorState::Error, message)
                }
            })
        })
    }

    /// Drop the instance: the sink's `clear` for its source, then its record and its cursor.
    pub fn remove_instance(&self, id: &str, name: &str) -> Result<(), PluginError> {
        let shared = &self.shared;
        shared.with(id, |installed| {
            installed.instance(id, name)?;
            shared.sink.clear(&source(id, name)).map_err(|e| {
                let message = format!("the index could not drop {id}/{name}: {e}");
                PluginError::Host(Error {
                    code: ErrorCode::Internal,
                    message,
                })
            })?;
            installed.instances.remove(name);
            shared.persist(id, installed).map_err(PluginError::Host)?;
            let cursor = shared.host.store_set(id, &cursor_key(name), Value::Null);
            cursor.map_err(PluginError::Host)
        })
    }

    /// The connector's instances with their settings (never the secret ones) and status.
    pub fn instances(&self, id: &str) -> Result<Vec<ConnectorInstance>, PluginError> {
        self.shared.with(id, |installed| {
            let all = installed.instances.iter();
            Ok(all.map(|(name, i)| listing(id, name, i)).collect())
        })
    }

    pub fn status(&self, id: &str, name: &str) -> Result<ConnectorStatus, PluginError> {
        self.shared.with(id, |installed| {
            Ok(installed.instance(id, name)?.status.clone())
        })
    }

    /// Stop syncing the instance until `resume`; it stays `paused` until the sync after that.
    pub fn pause(&self, id: &str, name: &str) -> Result<(), PluginError> {
        let shared = &self.shared;
        shared.with(id, |installed| {
            installed.instance(id, name)?.paused = true;
            shared.persist(id, installed).map_err(PluginError::Host)?;
            shared.set(id, name, installed, ConnectorState::Paused, None);
            Ok(())
        })
    }

    /// Sync the instance again from the next tick, with its backoff reset.
    pub fn resume(&self, id: &str, name: &str) -> Result<(), PluginError> {
        let shared = &self.shared;
        shared.with(id, |installed| {
            let due = schedule::interval(&installed.connector.sync).map(|_| shared.clock.now());
            let instance = installed.instance(id, name)?;
            (instance.paused, instance.due, instance.failures) = (false, due, 0);
            shared.persist(id, installed).map_err(PluginError::Host)
        })
    }

    /// Run every sync that is due, one at a time in (connector, instance) order, on this thread.
    /// Returns the pairs it ran.
    pub fn tick(&self) -> Vec<(String, String)> {
        self.shared.tick()
    }

    /// Sync the instance at once, whatever its backoff, and restart its interval from now.
    /// Refused while it is paused, or while its connector waits for a reload after a trap.
    pub fn sync_now(&self, id: &str, name: &str) -> Result<ConnectorStatus, PluginError> {
        let shared = &self.shared;
        shared.with(id, |installed| {
            if installed.instance(id, name)?.paused {
                return Err(PluginError::Paused(format!("{id}/{name}")));
            }
            if let Run::Crashed(why) = &installed.run {
                return Err(PluginError::Crashed(why.clone()));
            }
            Ok(shared.sync(id, installed, name))
        })
    }

    /// Ask the guest a live query for this instance; its items come back stamped and checked.
    pub fn query(&self, id: &str, name: &str, query: &ItemQuery) -> Result<ItemPage, PluginError> {
        let shared = &self.shared;
        let query = convert::query(query).map_err(PluginError::Host)?;
        shared.with(id, |installed| {
            let guest = installed.guest(id, name)?;
            let page = shared.call(id, installed, |c, store| {
                c.call_query(store, &guest, &query)
            })?;
            convert::page(page, &source(id, name)).map_err(PluginError::Host)
        })
    }

    /// Run one of the connector's actions, a command id it lists in `resources[].actions`; any
    /// other is `not-found` without calling the guest. `args` and the result are JSON.
    pub fn act(
        &self,
        id: &str,
        name: &str,
        action: &str,
        args: &Value,
    ) -> Result<Value, PluginError> {
        let shared = &self.shared;
        shared.with(id, |installed| {
            let guest = installed.guest(id, name)?;
            let resources = installed.connector.resources.iter();
            if !resources
                .flat_map(|r| r.actions.iter().flatten())
                .any(|a| a == action)
            {
                let message = format!("{id} lists no action {action} in resources[].actions");
                let code = ErrorCode::NotFound;
                return Err(PluginError::Host(Error { code, message }));
            }
            let args = if args.is_null() {
                "{}".to_owned()
            } else {
                args.to_string()
            };
            let call =
                |c: &Connector, store: &mut Store<State>| c.call_act(store, &guest, action, &args);
            let answer = shared.call(id, installed, call)?;
            serde_json::from_str(&answer).map_err(|e| {
                let why = format!("{id} answered {action} with text that is not JSON: {e}");
                PluginError::Host(invalid(why))
            })
        })
    }

    /// Every status change of every instance from now on: create, each sync's `syncing` and how it
    /// ended, `paused`, and `error` for each instance of a connector that trapped.
    pub fn watch_status(&self) -> Receiver<ConnectorInstance> {
        let (sender, receiver) = mpsc::channel();
        lock(&self.shared.watchers).push(sender);
        receiver
    }

    /// Run `tick` every `period` on the thread `desk-connector-scheduler` until the host drops
    /// (1 s in the desk). Starting it again replaces the thread.
    pub fn start_scheduler(&self, period: Duration) {
        let scheduler = Scheduler::start(Arc::downgrade(&self.shared), period);
        *lock(&self.scheduler) = Some(scheduler);
    }
}

impl Drop for ConnectorHost {
    fn drop(&mut self) {
        // Stop and join the scheduler first, so its thread never outlives the host.
        lock(&self.scheduler).take();
    }
}
