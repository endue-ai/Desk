//! Native notifications: the OS side of what the desk shows. Which notifications reach the OS is
//! decided above this crate; here a notifier posts one, asks the OS for permission and reports a
//! click. A notifier refuses with `permission_denied` until the OS allows it, without reaching the
//! OS, and never prompts on its own: `request_authorization` does. `os()` is UserNotifications on
//! macOS, a toast on Windows and freedesktop notifications over D-Bus on Linux; `fake` is a notifier
//! in memory for tests, here and in the crates above.

use std::sync::{Arc, Mutex, MutexGuard};

pub use desk_bridge::NotifyLevel;

use crate::{Error, ErrorCode};

pub mod fake;
#[cfg(target_os = "linux")]
pub mod freedesktop;
#[cfg(windows)]
mod toast;
#[cfg(target_os = "macos")]
mod usernotifications;

#[cfg(windows)]
pub use toast::toast_xml;

/// One notification as the OS shows it.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Notification {
    /// The desk's notification id (`ui.notified`'s `notificationId`), which a click reports.
    pub id: String,
    pub title: String,
    pub body: Option<String>,
    /// Linux shows `error` as critical; macOS and Windows show every level alike.
    pub level: NotifyLevel,
}

/// The person clicked a notification (the OS's default action, not a button).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Click {
    /// The `Notification::id` it was posted with.
    pub id: String,
}

/// Whether the OS lets the desk show notifications.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Authorization {
    /// Never asked: `request_authorization` shows the OS prompt.
    NotDetermined,
    /// The person or a policy said no; only the OS settings change it.
    Denied,
    /// Posting reaches the OS. macOS's provisional and ephemeral authorizations count.
    Authorized,
}

impl Authorization {
    /// Whether a notifier may post with this authorization.
    pub fn can_post(self) -> bool {
        self == Self::Authorized
    }
}

/// What `Notifier::on_click` takes. It runs on whichever thread the OS calls back on and must return
/// quickly.
pub type ClickHandler = Box<dyn Fn(Click) + Send + Sync>;

/// The OS notification centre. Nothing reaches it before the OS allows notifications.
pub trait Notifier: Send + Sync {
    /// The current authorization. Never prompts.
    fn authorization(&self) -> Authorization;
    /// Ask the OS for permission, showing its prompt if the person was never asked, and block until
    /// it answers. Returns the authorization afterwards; a refusal stays and is never asked again.
    fn request_authorization(&self) -> Result<Authorization, Error>;
    /// Show `notification`. `permission_denied` without reaching the OS unless `authorization()` is
    /// `Authorized`.
    fn post(&self, notification: &Notification) -> Result<(), Error>;
    /// Report clicks on notifications this notifier posted to `handler`. There is one handler: a
    /// second replaces the first.
    fn on_click(&self, handler: ClickHandler);
}

/// The OS notifier: UserNotifications on macOS. The bundle's own identifier and name are used, and
/// a process outside an app bundle (`cargo test`, `tauri dev`) is `unsupported`, because
/// UNUserNotificationCenter throws there. Every notifier in the process shares one click handler.
#[cfg(target_os = "macos")]
pub fn os(app_id: &str, app_name: &str) -> Result<Box<dyn Notifier>, Error> {
    let _ = (app_id, app_name);
    Ok(Box::new(usernotifications::UserNotifications::new()?))
}

/// The OS notifier: toasts for the AppUserModelID `app_id` (the Start menu shortcut's, which the
/// installers set to Tauri's identifier).
#[cfg(windows)]
pub fn os(app_id: &str, app_name: &str) -> Result<Box<dyn Notifier>, Error> {
    let _ = app_name;
    Ok(Box::new(toast::Toast::new(app_id)))
}

/// The OS notifier: freedesktop notifications on the session bus as `app_name`; `unsupported` when
/// no session bus is reachable.
#[cfg(target_os = "linux")]
pub fn os(app_id: &str, app_name: &str) -> Result<Box<dyn Notifier>, Error> {
    let _ = app_id;
    Ok(Box::new(freedesktop::Freedesktop::session(app_name)?))
}

/// The OS notifier: none here.
#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
pub fn os(app_id: &str, app_name: &str) -> Result<Box<dyn Notifier>, Error> {
    let _ = (app_id, app_name);
    Err(Error::new(
        ErrorCode::Unsupported,
        "native notifications exist on macOS, Windows and Linux only",
    ))
}

/// The `permission_denied` a notifier answers before reaching the OS.
pub(crate) fn denied(authorization: Authorization) -> Error {
    Error::new(
        ErrorCode::PermissionDenied,
        format!("posting a notification needs the OS's permission; it is {authorization:?}"),
    )
}

/// A click handler that can be called outside the lock that holds it.
type SharedHandler = Arc<dyn Fn(Click) + Send + Sync>;

/// A notifier's one click handler, shared with the thread the OS reports clicks on.
#[derive(Default)]
pub(crate) struct ClickSlot(Mutex<Option<SharedHandler>>);

impl ClickSlot {
    pub(crate) fn set(&self, handler: ClickHandler) {
        *self.lock() = Some(Arc::from(handler));
    }

    /// Calls the handler, if there is one, outside the lock: it may set another.
    pub(crate) fn fire(&self, click: Click) {
        let handler = self.lock().clone();
        if let Some(handler) = handler {
            handler(click);
        }
    }

    fn lock(&self) -> MutexGuard<'_, Option<SharedHandler>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}
