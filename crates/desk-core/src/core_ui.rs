//! The ui side of `Core`: ui.notify passes the permission engine and reaches the runtime as a
//! `ui.notified` event. How long it shows, and whether do-not-disturb holds it, is the runtime's
//! notify policy (ADR 0017).

use std::sync::atomic::Ordering;

use desk_bridge::{
    BridgeEvent, NotifyLevel, Permission, UiNotifiedData, UiNotifiedEvent, UiNotifyParams,
    UiNotifyResult,
};

use crate::handler::{Answer, Core, json};
use crate::perm::Target;

impl Core {
    pub(crate) fn notify(&self, caller: &str, params: UiNotifyParams) -> Answer {
        let scope = Permission::UiNotify(params.scope);
        self.check(caller, &scope, &Target::None)?;
        let n = self.notifications.fetch_add(1, Ordering::Relaxed) + 1;
        let notification_id = format!("n-{n}");
        self.events()
            .publish(BridgeEvent::UiNotified(UiNotifiedEvent {
                event: Default::default(),
                data: UiNotifiedData {
                    notification_id: notification_id.clone(),
                    caller: caller.to_owned(),
                    title: params.title,
                    body: params.body,
                    level: params.level.unwrap_or(NotifyLevel::Info),
                },
            }));
        json(UiNotifyResult { notification_id })
    }
}
