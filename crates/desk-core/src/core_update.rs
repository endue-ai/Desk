//! update.* (ADR 0054): the desk's own updates, served from the `desk_update::Updater` the app hands
//! the core. Every call checks `update:manage`; without an updater it answers `unsupported`. The
//! person's settings (`desk.update.channel`, `.auto`, `.check`) are read before each check, and every
//! change of the updater's status goes out as `update.changed` to the holders of `update:manage` and
//! the callers subscribed to it.

use std::sync::Arc;

use desk_bridge::{
    BridgeError, BridgeEvent, ErrorCode, EventName, Permission, SettingsSetParams, UpdateBuild,
    UpdateChangedEvent, UpdateChannel, UpdateManagePermission, UpdateParams, UpdateRelease,
    UpdateSetChannelParams, UpdateState, UpdateStatus,
};
use desk_update::{Channel, Prefs, State, Status, Updater};
use serde_json::Value;

use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;

/// The policy plugin that declares the update settings (`plugins/update`).
const OWNER: &str = "desk.update";
/// The runtime, whose own `update.channel` is the person's choice (`desk.update.channel`).
const RUNTIME: &str = "desk";

impl Core {
    /// Serve update.* from `updater`.
    pub fn with_updater(mut self, updater: Updater) -> Self {
        self.updater = Some(updater);
        self
    }

    /// Send the updater's changes as `update.changed` and check by the schedule, reading the
    /// settings before each check. Does nothing without an updater.
    pub fn start_updates(self: &Arc<Self>) {
        let Some(updater) = self.updater.clone() else {
            return;
        };
        updater.follow(self.update_prefs());
        let core = Arc::downgrade(self);
        updater.listen(move |status| {
            if let Some(core) = core.upgrade() {
                core.update_changed(status);
            }
        });
        let core = Arc::downgrade(self);
        updater.start(move || {
            core.upgrade()
                .map(|core| core.update_prefs())
                .unwrap_or_default()
        });
    }

    pub(crate) fn update_status(&self, caller: &str, params: UpdateParams) -> Answer {
        let updater = self.updater_for(caller, params, "update.status")?;
        updater.follow(self.update_prefs());
        json(bridge_status(&updater.status()))
    }

    pub(crate) fn update_check(&self, caller: &str, params: UpdateParams) -> Answer {
        let updater = self.updater_for(caller, params, "update.check")?;
        json(bridge_status(&updater.check(self.update_prefs())))
    }

    pub(crate) fn update_download(&self, caller: &str, params: UpdateParams) -> Answer {
        let updater = self.updater_for(caller, params, "update.download")?;
        let status = updater.download().map_err(invalid)?;
        json(bridge_status(&status))
    }

    pub(crate) fn update_apply(&self, caller: &str, params: UpdateParams) -> Answer {
        let updater = self.updater_for(caller, params, "update.apply")?;
        let status = updater.apply().map_err(invalid)?;
        json(bridge_status(&status))
    }

    /// update.setChannel: the person's `desk.update.channel` (the runtime's own `update.channel`),
    /// which the next check reads; answers the status on the new channel.
    pub(crate) fn update_set_channel(
        &self,
        caller: &str,
        params: UpdateSetChannelParams,
    ) -> Answer {
        let scope = UpdateParams {
            scope: params.scope,
        };
        let updater = self.updater_for(caller, scope, "update.setChannel")?;
        let name = match params.channel {
            UpdateChannel::Stable => "stable",
            UpdateChannel::Beta => "beta",
            UpdateChannel::Canary => "canary",
        };
        let set = SettingsSetParams {
            key: "update.channel".to_owned(),
            value: Value::from(name),
        };
        self.settings_set(RUNTIME, set)?;
        updater.follow(self.update_prefs());
        json(bridge_status(&updater.status()))
    }

    /// The person's update settings. Without a channel, a desk follows the channel its build came
    /// from (`Channel::of_version`): a final stable, a candidate (`-rc.<run>`) beta, a canary build
    /// (`-pre.<run>`) canary.
    pub(crate) fn update_prefs(&self) -> Prefs {
        let version = self
            .updater
            .as_ref()
            .map(|updater| updater.status().version)
            .unwrap_or_default();
        let setting = self.update_setting("channel");
        let channel = Channel::followed(setting.as_ref().and_then(Value::as_str), &version);
        let flag = |key| self.update_setting(key).and_then(|v| v.as_bool());
        Prefs {
            channel,
            auto: flag("auto").unwrap_or(true),
            check: flag("check").unwrap_or(true),
        }
    }

    /// A setting in force: one the runtime set as `desk` (`update.<key>`), init.yaml's
    /// `desk.update.<key>`, or the `desk.update` manifest's default.
    fn update_setting(&self, key: &str) -> Option<Value> {
        self.setting_in_force("desk", &format!("update.{key}"))
            .or_else(|| self.setting_in_force(OWNER, key))
    }

    fn updater_for(
        &self,
        caller: &str,
        params: UpdateParams,
        method: &str,
    ) -> Result<&Updater, BridgeError> {
        self.check(
            caller,
            &Permission::UpdateManage(params.scope),
            &Target::None,
        )?;
        self.updater.as_ref().ok_or_else(|| {
            let message = format!("{method} is not served: this build does not update itself");
            error(ErrorCode::Unsupported, message)
        })
    }

    fn update_changed(&self, status: &Status) {
        let managers = self.holders(&Permission::UpdateManage(UpdateManagePermission {
            permission: Default::default(),
        }));
        let to = self.recipients(EventName::UpdateChanged, managers);
        let event = UpdateChangedEvent {
            event: Default::default(),
            data: bridge_status(status),
        };
        self.events()
            .publish_to(to, BridgeEvent::UpdateChanged(event));
    }
}

fn invalid(reason: String) -> BridgeError {
    error(ErrorCode::InvalidParams, reason)
}

/// The bridge's shape of the updater's status.
fn bridge_status(status: &Status) -> UpdateStatus {
    UpdateStatus {
        state: match status.state {
            State::Idle => UpdateState::Idle,
            State::Checking => UpdateState::Checking,
            State::UpToDate => UpdateState::UpToDate,
            State::Available => UpdateState::Available,
            State::Downloading => UpdateState::Downloading,
            State::Staged => UpdateState::Staged,
            State::Applying => UpdateState::Applying,
            State::Failed => UpdateState::Failed,
        },
        current: UpdateBuild {
            version: status.version.clone(),
            commit: status.commit.clone(),
        },
        channel: match status.channel {
            Channel::Stable => UpdateChannel::Stable,
            Channel::Beta => UpdateChannel::Beta,
            Channel::Canary => UpdateChannel::Canary,
        },
        checked_at: status.checked_at.clone(),
        release: status.release.as_ref().map(|chosen| UpdateRelease {
            version: chosen.version.clone(),
            commit: chosen.commit.clone(),
            date: chosen.date.clone(),
            notes: chosen.notes.clone(),
        }),
        staged: status.release.is_some().then_some(status.staged),
        received: status.received,
        total: status.total,
        reason: status.reason.clone(),
    }
}
