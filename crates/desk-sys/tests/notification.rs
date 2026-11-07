//! desk-sys notification primitives (feature `notification`): the `Notifier` contract through
//! `FakeNotifier`, the macOS notifier refusing outside an app bundle, and the Windows toast XML.
//!
//! No test reaches an OS notification centre: the fake keeps what it is given, macOS refuses before
//! UserNotifications, and the toast XML is only a string. The freedesktop notifier has its own file.

use std::sync::{Arc, Mutex};

use desk_sys::ErrorCode;
use desk_sys::notification::fake::FakeNotifier;
use desk_sys::notification::{Authorization, Click, Notification, Notifier, NotifyLevel};

fn notification(id: &str, body: Option<&str>, level: NotifyLevel) -> Notification {
    Notification {
        id: id.to_owned(),
        title: format!("title of {id}"),
        body: body.map(str::to_owned),
        level,
    }
}

/// A click handler that keeps every click it is called with.
fn recorder() -> (Arc<Mutex<Vec<Click>>>, Box<dyn Fn(Click) + Send + Sync>) {
    let clicks = Arc::new(Mutex::new(Vec::new()));
    let kept = Arc::clone(&clicks);
    let handler = Box::new(move |click: Click| kept.lock().unwrap().push(click));
    (clicks, handler)
}

fn authorized() -> FakeNotifier {
    let fake = FakeNotifier::new().with_answer(Authorization::Authorized);
    assert_eq!(fake.request_authorization(), Ok(Authorization::Authorized));
    fake
}

#[test]
fn post_before_the_os_allows_it_is_permission_denied() {
    let fake = FakeNotifier::new();
    assert_eq!(fake.authorization(), Authorization::NotDetermined);

    let err = fake
        .post(&notification("n-1", Some("body"), NotifyLevel::Info))
        .unwrap_err();

    assert_eq!(err.code, ErrorCode::PermissionDenied);
    assert!(fake.posted().is_empty());
    assert_eq!(fake.prompts(), 0, "posting never asks the OS");
    assert_eq!(fake.authorization(), Authorization::NotDetermined);
}

#[test]
fn request_authorization_asks_once_and_keeps_a_refusal() {
    let fake = FakeNotifier::new().with_answer(Authorization::Denied);

    assert_eq!(fake.request_authorization(), Ok(Authorization::Denied));
    assert_eq!(fake.prompts(), 1);
    assert_eq!(fake.request_authorization(), Ok(Authorization::Denied));
    assert_eq!(fake.prompts(), 1, "a refusal is never asked again");
    assert_eq!(fake.authorization(), Authorization::Denied);

    let err = fake
        .post(&notification("n-1", None, NotifyLevel::Info))
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::PermissionDenied);
    assert!(fake.posted().is_empty());
}

#[test]
fn an_allowed_post_reaches_the_os_with_its_id_title_body_and_level() {
    let fake = authorized();
    assert_eq!(fake.prompts(), 1);
    let first = notification("n-1", None, NotifyLevel::Info);
    let second = notification("n-2", Some("3 tests failed"), NotifyLevel::Error);

    fake.post(&first).unwrap();
    fake.post(&second).unwrap();

    assert_eq!(fake.posted(), vec![first, second]);
    assert_eq!(fake.prompts(), 1);
}

#[test]
fn a_click_reaches_the_handler_with_the_notification_id() {
    let fake = authorized();
    fake.post(&notification("n-1", None, NotifyLevel::Info))
        .unwrap();
    fake.post(&notification("n-2", Some("body"), NotifyLevel::Warning))
        .unwrap();
    let (first, handler) = recorder();
    fake.on_click(handler);

    fake.click("n-2");
    assert_eq!(
        *first.lock().unwrap(),
        vec![Click {
            id: "n-2".to_owned()
        }]
    );

    fake.click("n-9");
    assert_eq!(
        first.lock().unwrap().len(),
        1,
        "an id never posted calls nothing"
    );

    let (second, handler) = recorder();
    fake.on_click(handler);
    fake.click("n-1");
    assert_eq!(
        first.lock().unwrap().len(),
        1,
        "the second handler replaced the first"
    );
    assert_eq!(
        *second.lock().unwrap(),
        vec![Click {
            id: "n-1".to_owned()
        }]
    );
}

/// UNUserNotificationCenter throws, and the process ends, outside an app bundle: reaching it from
/// the test binary would crash the test instead of failing it.
#[cfg(target_os = "macos")]
#[test]
fn os_is_unsupported_outside_an_app_bundle() {
    let err = match desk_sys::notification::os("ai.endue.desk", "endue Desk") {
        Ok(_) => panic!("the test binary is not an app bundle"),
        Err(err) => err,
    };
    assert_eq!(err.code, ErrorCode::Unsupported);
}

#[cfg(windows)]
#[test]
fn toast_xml_carries_the_id_and_escapes_the_text() {
    let xml = desk_sys::notification::toast_xml(&Notification {
        id: "n-1".to_owned(),
        title: "a <b> & c".to_owned(),
        body: Some("\"x\" > 'y'".to_owned()),
        level: NotifyLevel::Info,
    });

    assert!(xml.starts_with("<toast "), "{xml}");
    assert!(xml.contains(r#"launch="n-1""#), "{xml}");
    assert!(xml.contains("<text>a &lt;b&gt; &amp; c</text>"), "{xml}");
    assert!(
        xml.contains("<text>&quot;x&quot; &gt; &apos;y&apos;</text>"),
        "{xml}"
    );
    assert!(!xml.contains("<b>"), "{xml}");
}
