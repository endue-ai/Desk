//! The signed-in person's own account (ADR 0130), as endue.ai's Account and General settings read
//! and change it: who they are (`/api/v1/users/me`), their display language and time zone
//! (`/api/v1/users/me/preferences`) and which notifications reach them
//! (`/api/v1/notifications/preferences`).

use desk_sys::net::Method;
use serde_json::{Value, json};

use crate::Platform;
use crate::error::{ErrorKind, PlatformError, Result};
use crate::wire_account::{
    NotificationUpdate, Notifications, Preferences, PreferencesPatch, User, UserPatch,
};

const ME: &str = "/api/v1/users/me";
const PREFERENCES: &str = "/api/v1/users/me/preferences";
const NOTIFICATIONS: &str = "/api/v1/notifications/preferences";

fn nothing() -> PlatformError {
    PlatformError::new(ErrorKind::Invalid, "nothing to change")
}

fn body_of(value: &impl serde::Serialize) -> Result<Value> {
    serde_json::to_value(value).map_err(|e| PlatformError::new(ErrorKind::Failed, e.to_string()))
}

impl Platform {
    pub fn me(&self) -> Result<User> {
        self.read(Method::Get, ME, None, "account")
    }

    /// Change the name or the picture's address; the answer is the account now.
    pub fn update_me(&self, patch: &UserPatch) -> Result<User> {
        if patch.is_empty() {
            return Err(nothing());
        }
        self.read(Method::Patch, ME, Some(&body_of(patch)?), "account")
    }

    pub fn preferences(&self) -> Result<Preferences> {
        self.read(Method::Get, PREFERENCES, None, "preferences")
    }

    /// Change the display language or the time zone; the answer is the preferences now.
    pub fn update_preferences(&self, patch: &PreferencesPatch) -> Result<Preferences> {
        if patch.is_empty() {
            return Err(nothing());
        }
        let body = body_of(patch)?;
        self.read(Method::Patch, PREFERENCES, Some(&body), "preferences")
    }

    pub fn notifications(&self) -> Result<Notifications> {
        self.read(Method::Get, NOTIFICATIONS, None, "notification preferences")
    }

    /// Turn channels on or off; the answer is every kind's channels now.
    pub fn update_notifications(&self, updates: &[NotificationUpdate]) -> Result<Notifications> {
        if updates.is_empty() {
            return Err(nothing());
        }
        let body = json!({ "updates": body_of(&updates)? });
        self.read(
            Method::Put,
            NOTIFICATIONS,
            Some(&body),
            "notification preferences",
        )
    }
}
