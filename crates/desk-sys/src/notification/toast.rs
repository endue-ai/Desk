//! The Windows notifier over WinRT toasts, for one AppUserModelID. Windows has no permission prompt:
//! the person turns an app's notifications on or off in Settings, which `ToastNotifier::Setting`
//! reports. A toast's `Tag` and `launch` argument are the desk's id, and its `Activated` event is the
//! click; the toasts posted last are kept so a click from the Action Center still reaches it.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use windows::Data::Xml::Dom::XmlDocument;
use windows::Foundation::TypedEventHandler;
use windows::UI::Notifications::{
    NotificationSetting, ToastNotification, ToastNotificationManager, ToastNotifier,
};
use windows::core::{HSTRING, IInspectable, Ref};

use super::{Authorization, Click, ClickHandler, ClickSlot, Notification, Notifier, denied};
use crate::{Error, ErrorCode};

/// How many posted toasts stay referenced for their `Activated` event.
const KEPT: usize = 64;

pub(super) struct Toast {
    app_id: HSTRING,
    clicks: Arc<ClickSlot>,
    kept: Mutex<VecDeque<ToastNotification>>,
}

impl Toast {
    pub(super) fn new(app_id: &str) -> Self {
        Self {
            app_id: HSTRING::from(app_id),
            clicks: Arc::default(),
            kept: Mutex::new(VecDeque::new()),
        }
    }

    fn notifier(&self) -> windows::core::Result<ToastNotifier> {
        ToastNotificationManager::CreateToastNotifierWithId(&self.app_id)
    }

    fn show(&self, notification: &Notification) -> windows::core::Result<()> {
        let notifier = self.notifier()?;
        let document = XmlDocument::new()?;
        document.LoadXml(&HSTRING::from(toast_xml(notification)))?;
        let toast = ToastNotification::CreateToastNotification(&document)?;
        toast.SetTag(&HSTRING::from(notification.id.as_str()))?;
        let clicks = Arc::clone(&self.clicks);
        let id = notification.id.clone();
        toast.Activated(&TypedEventHandler::<ToastNotification, IInspectable>::new(
            move |_: Ref<ToastNotification>, _: Ref<IInspectable>| {
                clicks.fire(Click { id: id.clone() });
                Ok(())
            },
        ))?;
        notifier.Show(&toast)?;
        let mut kept = self.kept.lock().unwrap_or_else(|e| e.into_inner());
        if kept.len() == KEPT {
            kept.pop_front();
        }
        kept.push_back(toast);
        Ok(())
    }
}

impl Notifier for Toast {
    /// `Authorized` when the setting is `Enabled`; disabled for the app, the user, a group policy or
    /// a manifest, or a setting that cannot be read (an unregistered AppUserModelID), is `Denied`.
    fn authorization(&self) -> Authorization {
        match self.notifier().and_then(|notifier| notifier.Setting()) {
            Ok(NotificationSetting::Enabled) => Authorization::Authorized,
            _ => Authorization::Denied,
        }
    }

    /// Windows never prompts: this reads the setting.
    fn request_authorization(&self) -> Result<Authorization, Error> {
        Ok(self.authorization())
    }

    fn post(&self, notification: &Notification) -> Result<(), Error> {
        let authorization = self.authorization();
        if !authorization.can_post() {
            return Err(denied(authorization));
        }
        self.show(notification).map_err(|err| {
            Error::new(
                ErrorCode::IoError,
                format!("Windows refused the toast: {err}"),
            )
        })
    }

    fn on_click(&self, handler: ClickHandler) {
        self.clicks.set(handler);
    }
}

/// The toast's XML: the generic template with the title and the body, the id as its `launch`
/// argument, every value escaped.
pub fn toast_xml(notification: &Notification) -> String {
    let body = notification
        .body
        .as_deref()
        .map(|body| format!("<text>{}</text>", escape(body)))
        .unwrap_or_default();
    format!(
        r#"<toast launch="{}"><visual><binding template="ToastGeneric"><text>{}</text>{body}</binding></visual></toast>"#,
        escape(&notification.id),
        escape(&notification.title),
    )
}

/// XML-escaped, without the characters XML 1.0 forbids (control characters other than tab and line
/// breaks, U+FFFE and U+FFFF), which would make `LoadXml` refuse the whole toast.
fn escape(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            '\t' | '\n' | '\r' => escaped.push(c),
            '\u{0}'..='\u{1f}' | '\u{fffe}' | '\u{ffff}' => {}
            c => escaped.push(c),
        }
    }
    escaped
}
