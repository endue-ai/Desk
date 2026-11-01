//! The store side of `Core`: store.get and store.set in each caller's own namespace.

use std::path::PathBuf;
use std::sync::MutexGuard;

use desk_bridge::{ErrorCode, StoreGetParams, StoreGetResult, StoreSetParams, StoreSetResult};

use crate::handler::{Answer, Core, error, json};
use crate::store::Store;

impl Core {
    /// Keep store.set values in `path` (a JSON file in the app's data folder).
    pub fn with_store_file(self, path: PathBuf) -> Self {
        *self.kv() = Store::new(Some(path));
        self
    }

    pub(crate) fn store_get(&self, caller: &str, params: StoreGetParams) -> Answer {
        json(StoreGetResult {
            value: self.kv().get(caller, &params.key),
        })
    }

    pub(crate) fn store_set(&self, caller: &str, params: StoreSetParams) -> Answer {
        self.kv()
            .set(caller, &params.key, params.value)
            .map_err(|message| error(ErrorCode::InvalidParams, message))?;
        json(StoreSetResult {})
    }

    /// A value in `caller`'s namespace, for the core's own records (a connector's instances).
    pub(crate) fn stored(&self, caller: &str, key: &str) -> Option<serde_json::Value> {
        self.kv().get(caller, key)
    }

    /// Set a value in `caller`'s namespace, as store.set does.
    pub(crate) fn store_put(
        &self,
        caller: &str,
        key: &str,
        value: serde_json::Value,
    ) -> Result<(), String> {
        self.kv().set(caller, key, value)
    }

    fn kv(&self) -> MutexGuard<'_, Store> {
        self.store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
