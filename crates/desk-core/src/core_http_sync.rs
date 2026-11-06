//! One sync of an http connector's instance (ADR 0106): its status to `syncing`, the plugin's
//! `net:fetch` grant for the base host checked, the token read from the secrets file, every page read
//! (`http_binding`), and what changed written to the index; then `connected` or `error` with why.

use std::collections::BTreeMap;

use desk_bridge::{
    ConnectorError, ConnectorState, ConnectorStatus, Item, ItemQuery, ItemSource,
    NetFetchPermission, Permission,
};
use desk_index::DataReadScope;
use desk_plugin_host::rfc3339;
use desk_sys::net as sysnet;
use serde_json::{Value, json};

use crate::core_connectors::status;
use crate::core_http::{interval, missing, source};
use crate::handler::Core;
use crate::http_binding::{self, Failure};
use crate::perm::Target;

impl Core {
    /// One sync: `syncing`, then `connected` with the time, or `error` with why.
    pub(crate) fn sync_http(&self, id: &str, name: &str) {
        let syncing = {
            let mut http = self.http();
            let Some(instance) = http.0.get_mut(id).and_then(|i| i.get_mut(name)) else {
                return;
            };
            if instance.syncing {
                return;
            }
            instance.syncing = true;
            let every = self.http_manifest(id).and_then(|(c, _)| interval(&c));
            instance.due = every.map(|e| self.clock.now() + e);
            instance.status = status(ConnectorState::Syncing, instance.last_sync_at.clone(), None);
            instance.status.clone()
        };
        self.report(id, name, syncing);
        let outcome = self.run_http(id, name);
        let ended = {
            let mut http = self.http();
            let Some(instance) = http.0.get_mut(id).and_then(|i| i.get_mut(name)) else {
                // Disconnected meanwhile: what the sync wrote goes too.
                drop(http);
                if let Ok(index) = self.index() {
                    let _ = index.clear(&source(id, name));
                }
                return;
            };
            instance.syncing = false;
            instance.status = match outcome {
                Ok(()) => {
                    instance.last_sync_at = Some(rfc3339(self.clock.now()));
                    status(
                        ConnectorState::Connected,
                        instance.last_sync_at.clone(),
                        None,
                    )
                }
                Err(failure) => ConnectorStatus {
                    state: ConnectorState::Error,
                    last_sync_at: instance.last_sync_at.clone(),
                    error: Some(ConnectorError {
                        message: failure.message,
                        reauth: failure.reauth.then_some(true),
                    }),
                },
            };
            instance.status.clone()
        };
        self.persist_http(id);
        self.report(id, name, ended);
    }

    /// Read every page with the instance's token and write what changed since the index's copy.
    fn run_http(&self, id: &str, name: &str) -> Result<(), Failure> {
        let (_, binding) = self
            .http_manifest(id)
            .ok_or_else(|| Failure::new(missing(id).message))?;
        let base = binding.base_url.clone();
        let host = http_binding::host_of(&base)
            .ok_or_else(|| Failure::new(format!("{base} is not a URL")))?;
        let fetch = Permission::NetFetch(NetFetchPermission {
            permission: Default::default(),
            hosts: vec![host.clone()],
        });
        if self.check(id, &fetch, &Target::Url(&base)).is_err() {
            let why =
                format!("{id} may not fetch from {host}: it needs a net:fetch grant for {host}");
            return Err(Failure::new(why));
        }
        let token = match &binding.auth {
            Some(auth) => Some(
                self.lock_secrets()
                    .get(id, name, &auth.setting)
                    .ok_or_else(|| Failure {
                        message: format!("{id}/{name} has no {}: connect it again", auth.setting),
                        reauth: true,
                    })?,
            ),
            None => None,
        };
        let source = source(id, name);
        let mut call = |mut request: sysnet::Request| {
            request.allowed_hosts = vec![host.clone()];
            sysnet::fetch(&request).map_err(|e| Failure::new(e.message))
        };
        let synced = http_binding::sync(&binding, &base, token.as_deref(), &source, &mut call)?;
        self.write_http(&source, synced.items).map_err(Failure::new)
    }

    /// Write the items that are new or differ from the index's copy, remove the ones that left.
    fn write_http(&self, source: &ItemSource, fresh: BTreeMap<String, Item>) -> Result<(), String> {
        let index = self.index().map_err(|e| e.message)?.clone();
        let mut existing: BTreeMap<String, Value> = BTreeMap::new();
        let mut cursor: Option<String> = None;
        let key = format!("{}/{}", source.connector, source.instance);
        loop {
            let query = json!({ "sources": [key], "limit": 500, "cursor": cursor });
            let query: ItemQuery = serde_json::from_value(query).map_err(|e| e.to_string())?;
            let page = index
                .query(&query, &DataReadScope::all())
                .map_err(|e| e.message)?;
            for item in &page.items {
                let value = serde_json::to_value(item).unwrap_or_default();
                existing.insert(value["id"].as_str().unwrap_or_default().to_owned(), value);
            }
            cursor = page.cursor;
            if cursor.is_none() {
                break;
            }
        }
        let removed: Vec<String> = existing
            .keys()
            .filter(|id| !fresh.contains_key(*id))
            .cloned()
            .collect();
        let upserted: Vec<Item> = fresh
            .into_iter()
            .filter(|(id, item)| existing.get(id) != serde_json::to_value(item).ok().as_ref())
            .map(|(_, item)| item)
            .collect();
        if !upserted.is_empty() {
            index.upsert(&upserted).map_err(|e| e.message)?;
        }
        if !removed.is_empty() {
            index.remove(source, &removed).map_err(|e| e.message)?;
        }
        Ok(())
    }
}
