//! The events side of `Core`: events.subscribe and events.unsubscribe, and who an addressed event is
//! for. A caller hears events about its own work without asking; a subscription adds the named events
//! about every caller, under an `events:subscribe` scope covering every name. A subscription lasts
//! while a grant covers it and the caller is loaded. `settings.changed` and `log.entry` are accepted
//! names that nothing publishes yet.

use std::collections::BTreeMap;
use std::sync::MutexGuard;

use desk_bridge::{
    ErrorCode, EventName, EventsSubscribeParams, EventsSubscribeResult, EventsUnsubscribeParams,
    EventsUnsubscribeResult, Permission,
};

use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;

struct Subscription {
    caller: String,
    names: Vec<EventName>,
    scope: Permission,
}

/// Every caller's subscriptions, by id.
#[derive(Default)]
pub(crate) struct Subscriptions {
    next: u64,
    entries: BTreeMap<String, Subscription>,
}

impl Core {
    pub(crate) fn events_subscribe(&self, caller: &str, params: EventsSubscribeParams) -> Answer {
        let scope = Permission::EventsSubscribe(params.scope);
        self.check(caller, &scope, &Target::Events(&params.names))?;
        let subscription_id = {
            let mut subscriptions = self.subscriptions();
            subscriptions.next += 1;
            let id = format!("s-{}", subscriptions.next);
            subscriptions.entries.insert(
                id.clone(),
                Subscription {
                    caller: caller.to_owned(),
                    names: params.names,
                    scope,
                },
            );
            id
        };
        // One started under a once grant ends with the call that spent it.
        self.prune_subscriptions(caller);
        json(EventsSubscribeResult { subscription_id })
    }

    pub(crate) fn events_unsubscribe(
        &self,
        caller: &str,
        params: EventsUnsubscribeParams,
    ) -> Answer {
        let mut subscriptions = self.subscriptions();
        let id = &params.subscription_id;
        if !subscriptions
            .entries
            .get(id)
            .is_some_and(|s| s.caller == caller)
        {
            return Err(error(
                ErrorCode::NotFound,
                format!("{caller} has no subscription {id}"),
            ));
        }
        subscriptions.entries.remove(id);
        json(EventsUnsubscribeResult {})
    }

    /// How many subscriptions are live, for tests and diagnostics.
    pub fn subscription_count(&self) -> usize {
        self.subscriptions().entries.len()
    }

    /// An event `name` is for `to` and for every caller subscribed to it.
    pub(crate) fn recipients(&self, name: EventName, mut to: Vec<String>) -> Vec<String> {
        let subscriptions = self.subscriptions();
        to.extend(
            subscriptions
                .entries
                .values()
                .filter(|s| s.names.contains(&name))
                .map(|s| s.caller.clone()),
        );
        to
    }

    /// End the caller's subscriptions that its grants no longer cover.
    pub(crate) fn prune_subscriptions(&self, caller: &str) {
        let mut subscriptions = self.subscriptions();
        let permissions = self.permissions();
        subscriptions.entries.retain(|_, s| {
            s.caller != caller
                || permissions
                    .authorize(caller, &s.scope, &Target::Events(&s.names))
                    .is_ok()
        });
    }

    /// The caller unloaded: its subscriptions end.
    pub(crate) fn drop_subscriber(&self, caller: &str) {
        self.subscriptions()
            .entries
            .retain(|_, s| s.caller != caller);
    }

    fn subscriptions(&self) -> MutexGuard<'_, Subscriptions> {
        self.subscriptions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
