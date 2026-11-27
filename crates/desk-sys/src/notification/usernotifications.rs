//! The macOS notifier over UserNotifications: the app's shared `UNUserNotificationCenter`, its
//! permission prompt (alert and sound, no badge), and one delegate for the process that shows banners
//! while the app is active and reports a click. A notification's button is the one action of a
//! category named after its label; the center keeps every category the process registered.
//!
//! Like `calendar/eventkit.rs`, this module is allowed `unsafe` (the workspace denies it everywhere
//! else): for the delegate class, the framework's exported action identifier and the pointers its
//! completion handlers pass. Nothing unsafe leaves the module.
//!
//! UNUserNotificationCenter raises an exception, and the process ends, when the process is not an app
//! bundle, so `new` refuses before it is ever touched.
#![allow(unsafe_code)]

use std::collections::BTreeSet;
use std::ptr::NonNull;
use std::sync::{Arc, Mutex, OnceLock, mpsc};
use std::time::Duration;

use block2::{DynBlock, RcBlock};
use objc2::rc::{Retained, autoreleasepool};
use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{AllocAnyThread, DefinedClass, define_class, msg_send};
use objc2_foundation::{NSArray, NSBundle, NSError, NSSet, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent, UNNotification,
    UNNotificationAction, UNNotificationActionOptions, UNNotificationCategory,
    UNNotificationCategoryOptions, UNNotificationDefaultActionIdentifier,
    UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse,
    UNNotificationSettings, UNNotificationSound, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
};

use super::{Authorization, Click, ClickHandler, ClickSlot, Notification, Notifier, denied};
use crate::{Error, ErrorCode};

/// How long a settings read or a post waits for UserNotifications' completion handler.
const ANSWER_TIMEOUT: Duration = Duration::from_secs(10);
/// The identifier of a notification's button, which a response reports.
const BUTTON_ACTION: &str = "desk-action";
/// The prefix of a category's identifier; the button's label follows it.
const CATEGORY: &str = "desk-action:";

define_class!(
    // SAFETY: NSObject has no subclassing requirements, and `Delegate` does not implement `Drop`.
    #[unsafe(super(NSObject))]
    #[name = "DeskSysNotificationDelegate"]
    #[ivars = Arc<ClickSlot>]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl UNUserNotificationCenterDelegate for Delegate {
        /// The desk decides when to post, so a notification shows even while the app is active.
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            completion.call((presentation(),));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion: &DynBlock<dyn Fn()>,
        ) {
            // SAFETY: an immutable NSString the framework exports and never frees.
            let default = unsafe { UNNotificationDefaultActionIdentifier };
            let pressed = response.actionIdentifier();
            let action = pressed.isEqualToString(&NSString::from_str(BUTTON_ACTION));
            if action || pressed.isEqualToString(default) {
                let id = response.notification().request().identifier().to_string();
                self.ivars().fire(Click { id, action });
            }
            completion.call(());
        }
    }
);

// SAFETY: the delegate's only state is an `Arc<ClickSlot>`, which is Send and Sync, NSObject's retain
// and release are thread-safe, and UserNotifications calls it on a queue of its own.
unsafe impl Send for Delegate {}
// SAFETY: as for `Send`; no method takes `&mut self`.
unsafe impl Sync for Delegate {}

impl Delegate {
    fn new(clicks: Arc<ClickSlot>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(clicks);
        // SAFETY: NSObject's designated initializer, on an allocation with its ivars set.
        unsafe { msg_send![super(this), init] }
    }
}

/// The center's delegate. The center holds it weakly, so this keeps it for the life of the process.
static DELEGATE: OnceLock<Retained<Delegate>> = OnceLock::new();
/// The button labels whose categories the center holds: setting categories replaces them all.
static LABELS: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());

pub(super) struct UserNotifications {
    clicks: Arc<ClickSlot>,
}

impl UserNotifications {
    pub(super) fn new() -> Result<Self, Error> {
        if !in_app_bundle() {
            return Err(Error::new(
                ErrorCode::Unsupported,
                "macOS shows notifications only for an app bundle; this process is not one",
            ));
        }
        let delegate = DELEGATE.get_or_init(|| {
            let delegate = Delegate::new(Arc::default());
            center().setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
            delegate
        });
        Ok(Self {
            clicks: Arc::clone(delegate.ivars()),
        })
    }
}

impl Notifier for UserNotifications {
    /// `NotDetermined` if UserNotifications does not answer in time.
    fn authorization(&self) -> Authorization {
        let (sender, receiver) = mpsc::channel();
        let completion = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
            // SAFETY: UserNotifications passes settings that live for the call.
            let status = unsafe { settings.as_ref() }.authorizationStatus();
            let _ = sender.send(status);
        });
        autoreleasepool(|_| center().getNotificationSettingsWithCompletionHandler(&completion));
        match receiver.recv_timeout(ANSWER_TIMEOUT) {
            Ok(status) => authorization(status),
            Err(_) => Authorization::NotDetermined,
        }
    }

    fn request_authorization(&self) -> Result<Authorization, Error> {
        let before = self.authorization();
        if before != Authorization::NotDetermined {
            return Ok(before);
        }
        let (sender, receiver) = mpsc::channel::<Option<String>>();
        let completion = RcBlock::new(move |_granted: Bool, error: *mut NSError| {
            let _ = sender.send(message(error));
        });
        let options = UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound;
        autoreleasepool(|_| {
            center().requestAuthorizationWithOptions_completionHandler(options, &completion);
        });
        let error = receiver.recv().map_err(|_| {
            Error::new(
                ErrorCode::IoError,
                "UserNotifications dropped the authorization request without answering",
            )
        })?;
        let after = self.authorization();
        match error {
            Some(message) if after == Authorization::NotDetermined => Err(Error::new(
                ErrorCode::IoError,
                format!("UserNotifications refused the authorization request: {message}"),
            )),
            _ => Ok(after),
        }
    }

    fn post(&self, notification: &Notification) -> Result<(), Error> {
        let authorization = self.authorization();
        if !authorization.can_post() {
            return Err(denied(authorization));
        }
        if let Some(label) = &notification.action {
            register(label);
        }
        let (sender, receiver) = mpsc::channel::<Option<String>>();
        let completion = RcBlock::new(move |error: *mut NSError| {
            let _ = sender.send(message(error));
        });
        autoreleasepool(|_| {
            let content = UNMutableNotificationContent::new();
            content.setTitle(&NSString::from_str(&notification.title));
            if let Some(body) = &notification.body {
                content.setBody(&NSString::from_str(body));
            }
            content.setSound(Some(&UNNotificationSound::defaultSound()));
            if let Some(label) = &notification.action {
                content.setCategoryIdentifier(&NSString::from_str(&category(label)));
            }
            let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
                &NSString::from_str(&notification.id),
                &content,
                None,
            );
            center().addNotificationRequest_withCompletionHandler(&request, Some(&completion));
        });
        match receiver.recv_timeout(ANSWER_TIMEOUT) {
            Ok(None) => Ok(()),
            Ok(Some(message)) => Err(Error::new(
                ErrorCode::IoError,
                format!("UserNotifications refused the notification: {message}"),
            )),
            Err(_) => Err(Error::new(
                ErrorCode::Timeout,
                format!("UserNotifications did not answer the post in {ANSWER_TIMEOUT:?}"),
            )),
        }
    }

    fn on_click(&self, handler: ClickHandler) {
        self.clicks.set(handler);
    }
}

fn center() -> Retained<UNUserNotificationCenter> {
    UNUserNotificationCenter::currentNotificationCenter()
}

fn category(label: &str) -> String {
    format!("{CATEGORY}{label}")
}

/// Give the center a category whose one action is a button labelled `label`, with the ones it has.
/// A press on the button brings the app forward, as a click on the notification does.
fn register(label: &str) {
    let mut labels = LABELS.lock().unwrap_or_else(|e| e.into_inner());
    if !labels.insert(label.to_owned()) {
        return;
    }
    autoreleasepool(|_| {
        let categories: Vec<Retained<UNNotificationCategory>> = labels
            .iter()
            .map(|label| {
                let action = UNNotificationAction::actionWithIdentifier_title_options(
                    &NSString::from_str(BUTTON_ACTION),
                    &NSString::from_str(label),
                    UNNotificationActionOptions::Foreground,
                );
                UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
                    &NSString::from_str(&category(label)),
                    &NSArray::from_retained_slice(&[action]),
                    &NSArray::new(),
                    UNNotificationCategoryOptions::empty(),
                )
            })
            .collect();
        center().setNotificationCategories(&NSSet::from_retained_slice(&categories));
    });
}

/// Whether the process runs from an `.app` bundle with an identifier. A bare executable has neither,
/// or an identifier from an embedded Info.plist (as `tauri dev` had) but no bundle.
fn in_app_bundle() -> bool {
    autoreleasepool(|_| {
        let bundle = NSBundle::mainBundle();
        bundle.bundleIdentifier().is_some() && bundle.bundlePath().to_string().ends_with(".app")
    })
}

/// A banner, the list and the sound; an alert before macOS 11, which has neither banner nor list.
fn presentation() -> UNNotificationPresentationOptions {
    if objc2::available!(macos = 11.0) {
        UNNotificationPresentationOptions::Banner
            | UNNotificationPresentationOptions::List
            | UNNotificationPresentationOptions::Sound
    } else {
        #[allow(deprecated)]
        let alert = UNNotificationPresentationOptions::Alert;
        alert | UNNotificationPresentationOptions::Sound
    }
}

fn authorization(status: UNAuthorizationStatus) -> Authorization {
    match status {
        UNAuthorizationStatus::NotDetermined => Authorization::NotDetermined,
        UNAuthorizationStatus::Authorized
        | UNAuthorizationStatus::Provisional
        | UNAuthorizationStatus::Ephemeral => Authorization::Authorized,
        // `Denied`, and any status a later macOS adds: nothing shows, and asking won't help.
        _ => Authorization::Denied,
    }
}

/// The description of the NSError a completion handler passes, or `None` for nil.
fn message(error: *mut NSError) -> Option<String> {
    // SAFETY: UserNotifications passes nil or an NSError that lives for the call.
    unsafe { error.as_ref() }.map(|error| error.localizedDescription().to_string())
}
