//! The data side of `Core`: data.query, data.get, data.subscribe and data.unsubscribe over the item
//! index (desk-index, ADR 0033), each under the caller's `data:read` scope, which the index applies
//! inside its SQL. A subscription is the index's, forwarded by a thread of its own as `data.changed`
//! to its caller alone; it ends on data.unsubscribe, when no grant covers it any more (a revoke, a
//! spent `once` grant) and when its plugin unloads, like `events.subscribe`.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, MutexGuard};
use std::thread;
use std::time::Duration;

use desk_bridge::{
    BridgeError, BridgeEvent, DataChangedData, DataChangedEvent, DataGetParams, DataGetResult,
    DataQueryParams, DataSubscribeParams, DataSubscribeResult, DataUnsubscribeParams,
    DataUnsubscribeResult, ErrorCode, ItemChange, Permission,
};
use desk_index::{DataReadScope, ItemIndex};

use crate::events::EventBus;
use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;

/// How often a forwarding thread looks whether its subscription ended while nothing changed.
const POLL: Duration = Duration::from_millis(500);

struct DataSubscription {
    caller: String,
    scope: Permission,
    live: Arc<AtomicBool>,
}

/// Every caller's data subscriptions, by id (`d-<n>`).
#[derive(Default)]
pub(crate) struct DataSubscriptions {
    next: u64,
    entries: BTreeMap<String, DataSubscription>,
}

impl Core {
    /// Serve `data.*` from `index`, which the app opens as `index.sqlite` in its data folder.
    /// Without one, `data.*` answers `io_error` and syncs fail.
    pub fn with_index(mut self, index: Arc<dyn ItemIndex>) -> Self {
        self.index = Some(index);
        self
    }

    pub(crate) fn data_query(&self, caller: &str, params: DataQueryParams) -> Answer {
        let scope = self.data_scope(caller, params.scope)?;
        let page = self.index()?.query(&params.query, &scope);
        json(page.map_err(index_error)?)
    }

    pub(crate) fn data_get(&self, caller: &str, params: DataGetParams) -> Answer {
        let scope = self.data_scope(caller, params.scope)?;
        let item = self.index()?.get(&params.source, &params.id, &scope);
        json(DataGetResult {
            item: item.map_err(index_error)?,
        })
    }

    pub(crate) fn data_subscribe(&self, caller: &str, params: DataSubscribeParams) -> Answer {
        let permission = Permission::DataRead(params.scope.clone());
        let scope = self.data_scope(caller, params.scope)?;
        let changes = self.index()?.subscribe(&params.query, &scope);
        let changes = changes.map_err(index_error)?;
        let live = Arc::new(AtomicBool::new(true));
        let subscription_id = {
            let mut subscriptions = self.data_subscriptions();
            subscriptions.next += 1;
            let id = format!("d-{}", subscriptions.next);
            let (events, to, flag) = (self.events().clone(), caller.to_owned(), live.clone());
            let name = format!("desk-data-{id}");
            let forwarded = id.clone();
            thread::Builder::new()
                .name(name)
                .spawn(move || forward(events, to, forwarded, flag, changes))
                .map_err(|e| error(ErrorCode::Internal, e.to_string()))?;
            let subscription = DataSubscription {
                caller: caller.to_owned(),
                scope: permission,
                live,
            };
            subscriptions.entries.insert(id.clone(), subscription);
            id
        };
        // One started under a once grant ends with the call that spent it.
        self.prune_data(caller);
        json(DataSubscribeResult { subscription_id })
    }

    pub(crate) fn data_unsubscribe(&self, caller: &str, params: DataUnsubscribeParams) -> Answer {
        let mut subscriptions = self.data_subscriptions();
        let id = &params.subscription_id;
        if !subscriptions
            .entries
            .get(id)
            .is_some_and(|s| s.caller == caller)
        {
            return Err(error(
                ErrorCode::NotFound,
                format!("{caller} has no data subscription {id}"),
            ));
        }
        end(subscriptions.entries.remove(id));
        json(DataUnsubscribeResult {})
    }

    /// End the caller's data subscriptions that its grants no longer cover.
    pub(crate) fn prune_data(&self, caller: &str) {
        let mut subscriptions = self.data_subscriptions();
        let permissions = self.permissions();
        subscriptions.entries.retain(|_, s| {
            let covered = || permissions.authorize(caller, &s.scope, &Target::None);
            keep(s, s.caller != caller || covered().is_ok())
        });
    }

    /// The caller unloaded: its data subscriptions end.
    pub(crate) fn drop_data(&self, caller: &str) {
        let mut subscriptions = self.data_subscriptions();
        subscriptions
            .entries
            .retain(|_, s| keep(s, s.caller != caller));
    }

    /// The index, or `io_error` when the desk has none.
    pub(crate) fn index(&self) -> Result<&Arc<dyn ItemIndex>, BridgeError> {
        self.index
            .as_ref()
            .ok_or_else(|| error(ErrorCode::IoError, "the item index is not open".to_owned()))
    }

    /// Check the caller's `data:read` scope; the scope then narrows what the index answers.
    fn data_scope(
        &self,
        caller: &str,
        scope: desk_bridge::DataReadPermission,
    ) -> Result<DataReadScope, BridgeError> {
        let narrowed = DataReadScope::from(&scope);
        self.check(caller, &Permission::DataRead(scope), &Target::None)?;
        Ok(narrowed)
    }

    fn data_subscriptions(&self) -> MutexGuard<'_, DataSubscriptions> {
        self.data_subscriptions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Whether to keep `subscription`; one that goes stops forwarding.
fn keep(subscription: &DataSubscription, kept: bool) -> bool {
    if !kept {
        subscription.live.store(false, Ordering::SeqCst);
    }
    kept
}

/// Stop forwarding a subscription that was taken out.
fn end(subscription: Option<DataSubscription>) {
    if let Some(subscription) = subscription {
        subscription.live.store(false, Ordering::SeqCst);
    }
}

/// Publish each batch of `changes` as `data.changed` to `caller`, until the subscription ends.
/// Dropping the receiver ends the index's side at its next write.
fn forward(
    events: EventBus,
    caller: String,
    id: String,
    live: Arc<AtomicBool>,
    changes: Receiver<Vec<ItemChange>>,
) {
    loop {
        match changes.recv_timeout(POLL) {
            Ok(batch) if live.load(Ordering::SeqCst) => {
                let data = DataChangedData {
                    subscription_id: id.clone(),
                    changes: batch,
                };
                let event = BridgeEvent::DataChanged(DataChangedEvent {
                    event: Default::default(),
                    data,
                });
                events.publish_to(vec![caller.clone()], event);
            }
            Err(RecvTimeoutError::Timeout) if live.load(Ordering::SeqCst) => {}
            _ => return,
        }
    }
}

/// An index error as the bridge's: the index already speaks its codes.
pub(crate) fn index_error(e: desk_index::Error) -> BridgeError {
    error(e.code, e.message)
}
