//! What the connector host's methods and its scheduler thread share: the installed connectors, the
//! guarded calls into them, status changes and the records in each connector's store.

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use desk_bridge::{ConnectorInstance, ConnectorManifest, ConnectorState, ConnectorStatus};
use desk_bridge::{ItemSource, PluginKind, PluginManifest};
use serde_json::Value;
use wasmtime::Store;
use wasmtime::component::Component;

use super::instances::{INSTANCES, Instance, status};
use super::{Installed, Run, Shared};
use crate::bindings::Error;
use crate::connector_bindings::{Connector, Instance as GuestInstance};
use crate::imports::Imports;
use crate::logic::{PluginError, code_name, stopped};
use crate::manifest;
use crate::state::{self, State};

impl Shared {
    /// Compile `bytes` and instantiate them in a new store, under the limits.
    pub(super) fn instantiate(
        &self,
        manifest: &PluginManifest,
        bytes: &[u8],
    ) -> Result<Run, PluginError> {
        let component = Component::from_binary(&self.engine, bytes)
            .map_err(|e| PluginError::Compile(format!("{e:#}")))?;
        let imports = Imports::new(manifest, Arc::clone(&self.host));
        let mut store = state::store(&self.engine, imports, &self.limits);
        match Connector::instantiate(&mut *store, &component, &self.linker) {
            Ok(guest) => Ok(Run::Ready { store, guest }),
            Err(error) => Err(stopped(&error, &store, PluginError::Link)),
        }
    }

    /// Run `f` on the installed connector `id`, holding the lock.
    pub(super) fn with<R>(
        &self,
        id: &str,
        f: impl FnOnce(&mut Installed) -> Result<R, PluginError>,
    ) -> Result<R, PluginError> {
        let mut plugins = lock(&self.plugins);
        let installed = plugins
            .get_mut(id)
            .ok_or_else(|| PluginError::NotInstalled(id.to_owned()))?;
        f(installed)
    }

    /// Call the guest under the time limit. A trap or a limit marks the connector crashed and every
    /// instance of it `error`; an error the guest returns leaves the store usable.
    pub(super) fn call<R>(
        &self,
        id: &str,
        installed: &mut Installed,
        f: impl FnOnce(&Connector, &mut Store<State>) -> wasmtime::Result<Result<R, Error>>,
    ) -> Result<R, PluginError> {
        let (store, guest) = match &mut installed.run {
            Run::Ready { store, guest } => (store, guest),
            Run::Crashed(why) => return Err(PluginError::Crashed(why.clone())),
        };
        store.set_epoch_deadline(self.limits.ticks());
        match f(guest, store) {
            Ok(Ok(answer)) => Ok(answer),
            Ok(Err(error)) => Err(PluginError::Guest(error)),
            Err(trap) => {
                let error = stopped(&trap, store, PluginError::Trap);
                installed.run = Run::Crashed(error.to_string());
                self.crash_all(id, installed, &error.to_string());
                Err(error)
            }
        }
    }

    /// Put the instance in `state`, keeping its last sync, and tell every watcher.
    pub(super) fn set(
        &self,
        id: &str,
        name: &str,
        installed: &mut Installed,
        state: ConnectorState,
        message: Option<String>,
    ) -> ConnectorStatus {
        let Some(instance) = installed.instances.get_mut(name) else {
            return status(state, None, message);
        };
        instance.status = status(state, instance.last_sync_at.clone(), message);
        let change = listing(id, name, instance);
        lock(&self.watchers).retain(|watcher| watcher.send(change.clone()).is_ok());
        instance.status.clone()
    }

    /// Every instance of the connector to `error` with `message`.
    pub(super) fn crash_all(&self, id: &str, installed: &mut Installed, message: &str) {
        let names: Vec<String> = installed.instances.keys().cloned().collect();
        for name in names {
            let message = Some(message.to_owned());
            self.set(id, &name, installed, ConnectorState::Error, message);
        }
    }

    /// Write every instance's record to the connector's store.
    pub(super) fn persist(&self, id: &str, installed: &Installed) -> Result<(), Error> {
        let records = installed.instances.iter().map(|(name, i)| i.record(name));
        let records = Value::Array(records.collect());
        self.host.store_set(id, INSTANCES, records)
    }

    /// Run every due sync, one at a time in (connector, instance) order: not paused, its connector
    /// not crashed, its due time reached. Returns the pairs it ran.
    pub(super) fn tick(&self) -> Vec<(String, String)> {
        let now = self.clock.now();
        let mut ran = Vec::new();
        let mut plugins = lock(&self.plugins);
        for (id, installed) in plugins.iter_mut() {
            let due = installed.instances.iter().filter(|(_, instance)| {
                !instance.paused && instance.due.is_some_and(|at| at <= now)
            });
            let due: Vec<String> = due.map(|(name, _)| name.clone()).collect();
            for name in due {
                if matches!(installed.run, Run::Crashed(_)) {
                    break;
                }
                self.sync(id, installed, &name);
                ran.push((id.clone(), name));
            }
        }
        ran
    }
}

impl Installed {
    pub(super) fn instance(&mut self, id: &str, name: &str) -> Result<&mut Instance, PluginError> {
        let missing = || PluginError::NoInstance(format!("{id}/{name}"));
        self.instances.get_mut(name).ok_or_else(missing)
    }

    /// The instance as the guest sees it.
    pub(super) fn guest(&self, id: &str, name: &str) -> Result<GuestInstance, PluginError> {
        let missing = || PluginError::NoInstance(format!("{id}/{name}"));
        let instance = self.instances.get(name).ok_or_else(missing)?;
        Ok(instance.guest(name, self.connector.instance_settings.as_ref()))
    }
}

/// The manifest of the Wasm connector in `dir`, its connector block, and its entry's bytes.
pub(super) fn read(
    dir: &Path,
) -> Result<(PluginManifest, ConnectorManifest, Vec<u8>), PluginError> {
    let (manifest, bytes) = manifest::read(dir, PluginKind::Connector)?;
    let missing = || PluginError::Manifest(format!("{} declares no connector block", manifest.id));
    let connector = manifest.connector.clone().ok_or_else(missing)?;
    Ok((manifest, connector, bytes))
}

/// The instance as the host lists it and tells watchers about it.
pub(super) fn listing(id: &str, name: &str, instance: &Instance) -> ConnectorInstance {
    ConnectorInstance {
        connector: id.to_owned(),
        instance: name.to_owned(),
        title: None,
        settings: Some(instance.settings.clone()),
        status: instance.status.clone(),
    }
}

/// The source the host stamps on the instance's items.
pub(super) fn source(id: &str, name: &str) -> ItemSource {
    ItemSource {
        connector: id.to_owned(),
        instance: name.to_owned(),
    }
}

/// Whether the error stopped the whole connector (a trap or a limit), not one call.
pub(super) fn crashes(error: &PluginError) -> bool {
    matches!(
        error,
        PluginError::Trap(_) | PluginError::TimeLimit | PluginError::MemoryLimit
    )
}

/// An error as a status message: `not-found: …`.
pub(super) fn describe(error: &Error) -> String {
    format!("{}: {}", code_name(error.code), error.message)
}

/// A failed call as a status message.
pub(super) fn failure(error: &PluginError) -> String {
    match error {
        PluginError::Guest(error) | PluginError::Host(error) => describe(error),
        other => other.to_string(),
    }
}

/// The lock, even if a thread panicked while it held it: the data stays consistent per call.
pub(super) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}
