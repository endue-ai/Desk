//! The person's own account as endue AI keeps it (user-service and notification-service, ADR 0130):
//! the account, the preferences Desk shows of it, and the channels of each kind of notification.
//! Read tolerantly, as `wire` reads: unknown fields are ignored and `null` reads as absent.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::wire::nullable;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UserStatus {
    Active,
    Inactive,
    Suspended,
}

/// `UserGetResponse`: who the person is on endue.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct User {
    pub id: String,
    pub email: String,
    #[serde(default)]
    pub display_name: Option<String>,
    /// The picture's address, as the person typed it.
    #[serde(default)]
    pub avatar_url: Option<String>,
    pub status: UserStatus,
    pub created_at: String,
}

/// `UserUpdateRequest`: the keys to change; an empty `avatar_url` clears the picture.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct UserPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

impl UserPatch {
    pub fn is_empty(&self) -> bool {
        self.display_name.is_none() && self.avatar_url.is_none()
    }
}

/// `UserPreferenceResponse`, what Desk reads of it: the display language (absent while the person
/// never chose one) and the time zone.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Preferences {
    #[serde(default)]
    pub locale: Option<String>,
    pub timezone: String,
}

/// `UserPreferenceUpdateRequest`: the keys to change.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct PreferencesPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
}

impl PreferencesPatch {
    pub fn is_empty(&self) -> bool {
        self.locale.is_none() && self.timezone.is_none()
    }
}

/// `NotificationChannels`: whether one kind reaches the person in endue's inbox, by email, by push.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
pub struct Channels {
    #[serde(default, deserialize_with = "nullable")]
    pub in_app: bool,
    #[serde(default, deserialize_with = "nullable")]
    pub email: bool,
    #[serde(default, deserialize_with = "nullable")]
    pub push: bool,
}

/// `NotificationPreferences`: every kind by its type.
pub type Notifications = BTreeMap<String, Channels>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Channel {
    InApp,
    Email,
    Push,
}

/// `NotificationPreferenceUpdate`: one channel of one kind, on or off.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NotificationUpdate {
    pub notification_type: String,
    pub channel: Channel,
    pub enabled: bool,
}
