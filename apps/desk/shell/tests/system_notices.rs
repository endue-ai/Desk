//! Acceptance (#306): a desk notice reaches the OS's notifications only while endue is out of
//! sight, never twice with the island, asking the OS once on the first post, and a click tells the
//! page. Every test uses desk-sys's `FakeNotifier`: nothing reaches a real notification centre.

use std::sync::{Arc, Mutex};

use desk_shell::system_notices::{Now, Outcome, Post, SystemNotices, activation};
use desk_sys::notification::fake::FakeNotifier;
use desk_sys::notification::{Authorization, Click, Notifier};
use serde_json::json;

fn post(id: &str, when: &str, island: bool) -> Post {
    Post::parse(&json!({
        "id": id, "title": format!("title of {id}"), "body": "body", "level": "warning",
        "action": "Restart", "when": when, "island": island,
    }))
    .unwrap()
}

fn notices(fake: &Arc<FakeNotifier>) -> (SystemNotices, Arc<Mutex<Vec<Click>>>) {
    let clicks = Arc::new(Mutex::new(Vec::new()));
    let kept = Arc::clone(&clicks);
    let notifier: Arc<dyn Notifier> = Arc::clone(fake) as Arc<dyn Notifier>;
    let notices = SystemNotices::new(Some(notifier), move |click| {
        kept.lock().unwrap().push(click)
    });
    (notices, clicks)
}

const FRONT: Now = Now {
    front: true,
    island: false,
};
const AWAY: Now = Now {
    front: false,
    island: false,
};
const ISLAND: Now = Now {
    front: false,
    island: true,
};

fn ids(fake: &FakeNotifier) -> Vec<String> {
    fake.posted().into_iter().map(|n| n.id).collect()
}

#[test]
fn posts_only_while_the_desk_is_not_in_front() {
    let fake = Arc::new(FakeNotifier::new());
    let (notices, _) = notices(&fake);

    assert_eq!(
        notices.post(&post("a", "background", false), FRONT),
        Outcome::Skipped
    );
    assert_eq!(
        notices.post(&post("b", "background", false), AWAY),
        Outcome::Posted
    );
    assert_eq!(
        notices.post(&post("c", "always", false), FRONT),
        Outcome::Posted
    );
    assert_eq!(ids(&fake), ["b", "c"]);

    let posted = &fake.posted()[0];
    assert_eq!(posted.title, "title of b");
    assert_eq!(posted.body.as_deref(), Some("body"));
    assert_eq!(posted.action.as_deref(), Some("Restart"));
}

#[test]
fn a_notice_the_island_shows_is_not_posted() {
    let fake = Arc::new(FakeNotifier::new());
    let (notices, _) = notices(&fake);

    assert_eq!(
        notices.post(&post("a", "background", true), ISLAND),
        Outcome::Skipped
    );
    assert_eq!(
        notices.post(&post("b", "always", true), ISLAND),
        Outcome::Skipped
    );
    assert_eq!(
        notices.post(&post("c", "background", true), AWAY),
        Outcome::Posted
    );
    assert_eq!(
        notices.post(&post("d", "background", false), ISLAND),
        Outcome::Posted
    );
    assert_eq!(ids(&fake), ["c", "d"]);
}

#[test]
fn asks_the_os_once_on_the_first_post_never_at_start() {
    let fake = Arc::new(FakeNotifier::new());
    let (notices, _) = notices(&fake);
    assert_eq!(fake.prompts(), 0, "making the service asks nothing");

    notices.post(&post("a", "background", false), FRONT);
    assert_eq!(
        fake.prompts(),
        0,
        "a notice that is not posted asks nothing"
    );
    notices.post(&post("b", "background", false), AWAY);
    notices.post(&post("c", "background", false), AWAY);
    assert_eq!(fake.prompts(), 1);
    assert_eq!(ids(&fake), ["b", "c"]);

    let refusing = Arc::new(FakeNotifier::new().with_answer(Authorization::Denied));
    let (notices, _) = self::notices(&refusing);
    assert!(matches!(
        notices.post(&post("x", "always", false), AWAY),
        Outcome::Refused(_)
    ));
    assert!(matches!(
        notices.post(&post("y", "always", false), AWAY),
        Outcome::Refused(_)
    ));
    assert_eq!(refusing.prompts(), 1, "a refusal is never asked again");
    assert!(refusing.posted().is_empty());
}

#[test]
fn a_click_brings_the_desk_forward_and_tells_the_page() {
    let fake = Arc::new(FakeNotifier::new());
    let (notices, clicks) = notices(&fake);
    notices.post(&post("a", "background", false), AWAY);

    fake.click("a");
    fake.press("a");
    let clicks = clicks.lock().unwrap().clone();
    let told: Vec<_> = clicks.iter().map(activation).collect();
    assert_eq!(
        told,
        [
            json!({ "id": "a", "action": false }),
            json!({ "id": "a", "action": true })
        ]
    );
}

#[test]
fn a_desk_without_os_notifications_refuses_without_failing() {
    let notices = SystemNotices::new(None, |_| {});
    assert!(matches!(
        notices.post(&post("a", "always", false), AWAY),
        Outcome::Refused(_)
    ));
}
