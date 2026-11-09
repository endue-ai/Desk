//! account.settings.* (ADR 0130): the signed-in account's own settings on endue, the ones endue.ai's
//! Account and General settings show, read and changed through endue AI's platform API
//! (desk-platform) with the account's token. Every call checks `account:manage`; a desk without
//! an endue ID answers `unsupported` and a signed-out one `signed_out`, before anything is sent.
//! The account itself must answer; its preferences and notifications are read beside it on their
//! own threads, and a part endue does not answer for is named in `problems`. A changed name or
//! picture renews the profile account.status shows, which goes out as `account.changed`.

use std::sync::Arc;
use std::thread;

use desk_bridge::{
    AccountManagePermission, AccountNotification, AccountParams, AccountSettings,
    AccountSettingsPart, AccountSettingsProblem, AccountSettingsUpdateParams, BridgeError,
    ErrorCode,
};
use desk_platform::wire_account::{
    Channel, NotificationUpdate, Notifications, Preferences, PreferencesPatch, User, UserPatch,
};
use desk_platform::{ErrorKind, Platform, PlatformError, Result as Reply};

use crate::account::State;
use crate::account_settings::{KINDS, endue_kind, language, time_zone, user};
use crate::core_studio::{failed, invalid, words};
use crate::handler::{Answer, Core, error, json};
use crate::studio::map::cut;

const SIGN_IN: &str = "Sign in to endue to see your account's settings.";

/// A part's answer, or its problem.
fn keep<T>(
    part: AccountSettingsPart,
    answer: Reply<T>,
    problems: &mut Vec<AccountSettingsProblem>,
) -> Option<T> {
    answer
        .map_err(|e| {
            let error = failed(e);
            problems.push(AccountSettingsProblem {
                part,
                code: error.code,
                message: cut(&error.message, 2000),
            });
        })
        .ok()
}

/// A part thread's answer; one that panicked is a failure like any other.
fn joined<T>(handle: thread::ScopedJoinHandle<'_, Reply<T>>) -> Reply<T> {
    handle.join().unwrap_or_else(|_| {
        let why = "the desk could not wait for endue";
        Err(PlatformError::new(ErrorKind::Failed, why))
    })
}

/// The settings, from the answers a change already gave and fresh reads of the rest.
fn settings_of(
    platform: &Platform,
    user_now: Option<User>,
    preferences_now: Option<Preferences>,
    notifications_now: Option<Notifications>,
) -> Result<AccountSettings, BridgeError> {
    let (me, preferences, notifications) = thread::scope(|s| {
        let me = user_now.is_none().then(|| s.spawn(|| platform.me()));
        let preferences = preferences_now
            .is_none()
            .then(|| s.spawn(|| platform.preferences()));
        let notifications = notifications_now
            .is_none()
            .then(|| s.spawn(|| platform.notifications()));
        (
            me.map(joined),
            preferences.map(joined),
            notifications.map(joined),
        )
    });
    let me = match (user_now, me) {
        (Some(given), _) => given,
        (None, Some(answer)) => answer.map_err(failed)?,
        (None, None) => unreachable!("the account is read when no change gave it"),
    };
    let mut problems = Vec::new();
    let preferences = preferences_now.or_else(|| {
        let answer = preferences?;
        keep(AccountSettingsPart::Preferences, answer, &mut problems)
    });
    let notifications = notifications_now.or_else(|| {
        let answer = notifications?;
        keep(AccountSettingsPart::Notifications, answer, &mut problems)
    });
    let shown = notifications.map(|all| {
        KINDS
            .iter()
            .filter_map(|(kind, name)| {
                let channels = all.get(*name)?;
                Some(AccountNotification {
                    kind: *kind,
                    in_app: channels.in_app,
                })
            })
            .collect()
    });
    Ok(AccountSettings {
        user: user(me),
        language: preferences
            .as_ref()
            .and_then(|p| language(p.locale.as_deref()?)),
        time_zone: preferences.as_ref().and_then(|p| time_zone(&p.timezone)),
        notifications: shown.unwrap_or_default(),
        problems,
    })
}

impl Core {
    /// The platform for account.settings.* as `caller`, once the desk is signed in.
    fn settings_platform(
        &self,
        caller: &str,
        scope: AccountManagePermission,
    ) -> Result<(Arc<crate::account::Account>, Arc<Platform>), BridgeError> {
        let account = Arc::clone(self.account_for(caller, scope)?);
        let signed_out = || error(ErrorCode::SignedOut, SIGN_IN.to_owned());
        if account.status().state != State::SignedIn {
            return Err(signed_out());
        }
        let platform = self
            .studio
            .platform(Some(&account))
            .ok_or_else(signed_out)?;
        Ok((account, platform))
    }

    pub(crate) fn account_settings_get(&self, caller: &str, params: AccountParams) -> Answer {
        let (_, platform) = self.settings_platform(caller, params.scope)?;
        json(settings_of(&platform, None, None, None)?)
    }

    pub(crate) fn account_settings_update(
        &self,
        caller: &str,
        params: AccountSettingsUpdateParams,
    ) -> Answer {
        let profile = UserPatch {
            display_name: params
                .display_name
                .as_deref()
                .map(|name| words(name, "the name", 200))
                .transpose()?,
            avatar_url: params.avatar_url.as_deref().map(picture).transpose()?,
        };
        let preferences = PreferencesPatch {
            locale: params
                .language
                .as_deref()
                .map(checked_language)
                .transpose()?,
            timezone: params.time_zone.as_deref().map(checked_zone).transpose()?,
        };
        let updates: Vec<NotificationUpdate> = params
            .notifications
            .iter()
            .flatten()
            .map(|n| NotificationUpdate {
                notification_type: endue_kind(&n.kind).to_owned(),
                channel: Channel::InApp,
                enabled: n.in_app,
            })
            .collect();
        if profile.is_empty() && preferences.is_empty() && updates.is_empty() {
            return Err(invalid("name a setting to change"));
        }
        let (account, platform) = self.settings_platform(caller, params.scope)?;
        let user_now = if profile.is_empty() {
            None
        } else {
            let changed = platform.update_me(&profile).map_err(failed)?;
            // The account bar shows the new name and picture; endue's picture is fetched again.
            thread::spawn(move || account.refresh_profile());
            Some(changed)
        };
        let preferences_now = if preferences.is_empty() {
            None
        } else {
            Some(platform.update_preferences(&preferences).map_err(failed)?)
        };
        let notifications_now = if updates.is_empty() {
            None
        } else {
            Some(platform.update_notifications(&updates).map_err(failed)?)
        };
        json(settings_of(
            &platform,
            user_now,
            preferences_now,
            notifications_now,
        )?)
    }
}

/// The picture's address as endue keeps it: trimmed, empty to clear it, else http or https.
fn picture(url: &str) -> Result<String, BridgeError> {
    let url = url.trim();
    let web = url.starts_with("https://") || url.starts_with("http://");
    let whole = url.len() > "https://".len() && !url.chars().any(char::is_whitespace);
    if url.is_empty() || (web && whole && url.chars().count() <= 2048) {
        Ok(url.to_owned())
    } else {
        Err(invalid(
            "the picture's address must be an http or https URL",
        ))
    }
}

fn checked_language(tag: &str) -> Result<String, BridgeError> {
    language(tag).ok_or_else(|| invalid("the language must be a BCP 47 tag, like en-US"))
}

fn checked_zone(zone: &str) -> Result<String, BridgeError> {
    time_zone(zone).ok_or_else(|| invalid("the time zone must be an IANA name, like Asia/Seoul"))
}

#[cfg(test)]
mod tests {
    use desk_bridge::AccountNotificationKind;

    use super::*;

    #[test]
    fn a_picture_is_a_web_address_or_nothing() {
        assert_eq!(picture("  ").unwrap(), "");
        assert_eq!(
            picture(" https://cdn.example.com/a.png ").unwrap(),
            "https://cdn.example.com/a.png"
        );
        for bad in [
            "file:///a.png",
            "https://",
            "https://a b",
            "data:image/png;base64,AA",
        ] {
            assert_eq!(
                picture(bad).unwrap_err().code,
                ErrorCode::InvalidParams,
                "{bad}"
            );
        }
    }

    #[test]
    fn every_kind_has_endues_name() {
        let names: Vec<&str> = KINDS.iter().map(|(_, name)| *name).collect();
        assert_eq!(
            names,
            [
                "conversation_reply",
                "routine_completed",
                "routine_failed",
                "routine_skipped",
                "agent_notice"
            ]
        );
        assert_eq!(
            endue_kind(&AccountNotificationKind::AgentNotice),
            "agent_notice"
        );
    }
}
