//! The person's own account against the in-process fake (ADR 0130): who they are, the name and the
//! picture's address changed key by key, the display language and time zone, and the inbox
//! channel of each kind of notification. Nothing leaves 127.0.0.1.

use std::sync::Arc;

use desk_platform::fake::FakePlatform;
use desk_platform::wire_account::{
    Channel, NotificationUpdate, PreferencesPatch, UserPatch, UserStatus,
};
use desk_platform::{ErrorKind, Platform, Tokens};
use serde_json::json;

struct Token(Option<&'static str>);

impl Tokens for Token {
    fn token(&self) -> Option<String> {
        self.0.map(str::to_owned)
    }

    fn refresh(&self, _rejected: &str) -> Option<String> {
        None
    }
}

fn client(fake: &FakePlatform) -> Platform {
    Platform::new(fake.url(), Arc::new(Token(Some("token-1")))).unwrap()
}

#[test]
fn the_account_is_read_bare_with_the_token() {
    let fake = FakePlatform::start();
    let me = client(&fake).me().unwrap();
    assert_eq!(me.email, "ada@example.com");
    assert_eq!(me.display_name.as_deref(), Some("Ada"));
    assert_eq!(me.avatar_url, None);
    assert_eq!(me.status, UserStatus::Active);
    let seen = fake.seen_at("GET", "/api/v1/users/me");
    assert_eq!(seen[0].headers["authorization"], "Bearer token-1");
    assert!(!seen[0].headers.contains_key("origin"));
}

#[test]
fn a_profile_change_sends_only_the_keys_it_changes() {
    let fake = FakePlatform::start();
    fake.state().account.user["avatar_url"] = json!("https://cdn.example.com/a.png");
    let patch = UserPatch {
        display_name: Some("Ada Lovelace".to_owned()),
        avatar_url: None,
    };
    let me = client(&fake).update_me(&patch).unwrap();
    assert_eq!(me.display_name.as_deref(), Some("Ada Lovelace"));
    assert_eq!(
        me.avatar_url.as_deref(),
        Some("https://cdn.example.com/a.png")
    );
    let sent = &fake.seen_at("PATCH", "/api/v1/users/me")[0].body;
    assert_eq!(sent, &json!({ "display_name": "Ada Lovelace" }));

    // An empty address clears the picture, as endue.ai's web does.
    let clear = UserPatch {
        avatar_url: Some(String::new()),
        ..UserPatch::default()
    };
    assert_eq!(
        client(&fake)
            .update_me(&clear)
            .unwrap()
            .avatar_url
            .as_deref(),
        Some("")
    );
}

#[test]
fn nothing_to_change_is_refused_before_endue_is_asked() {
    let fake = FakePlatform::start();
    let platform = client(&fake);
    let profile = platform.update_me(&UserPatch::default()).unwrap_err();
    let preferences = platform
        .update_preferences(&PreferencesPatch::default())
        .unwrap_err();
    let notifications = platform.update_notifications(&[]).unwrap_err();
    for error in [profile, preferences, notifications] {
        assert_eq!(error.kind, ErrorKind::Invalid);
    }
    assert!(fake.seen().is_empty());
}

#[test]
fn the_language_and_time_zone_are_read_and_changed() {
    let fake = FakePlatform::start();
    let platform = client(&fake);
    let before = platform.preferences().unwrap();
    assert_eq!(before.locale, None);
    assert_eq!(before.timezone, "America/New_York");
    let patch = PreferencesPatch {
        locale: Some("ja-JP".to_owned()),
        timezone: Some("Asia/Seoul".to_owned()),
    };
    let after = platform.update_preferences(&patch).unwrap();
    assert_eq!(after.locale.as_deref(), Some("ja-JP"));
    assert_eq!(after.timezone, "Asia/Seoul");
    let sent = &fake.seen_at("PATCH", "/api/v1/users/me/preferences")[0].body;
    assert_eq!(
        sent,
        &json!({ "locale": "ja-JP", "timezone": "Asia/Seoul" })
    );
}

#[test]
fn notification_channels_come_out_of_their_envelope_and_change_by_kind() {
    let fake = FakePlatform::start();
    let platform = client(&fake);
    let all = platform.notifications().unwrap();
    assert!(all["routine_completed"].in_app);
    assert!(all["agent_notice"].push);
    let updates = [NotificationUpdate {
        notification_type: "routine_completed".to_owned(),
        channel: Channel::InApp,
        enabled: false,
    }];
    let after = platform.update_notifications(&updates).unwrap();
    assert!(!after["routine_completed"].in_app);
    assert!(after["routine_failed"].in_app);
    let sent = &fake.seen_at("PUT", "/api/v1/notifications/preferences")[0].body;
    let update =
        json!({ "notification_type": "routine_completed", "channel": "in_app", "enabled": false });
    assert_eq!(sent, &json!({ "updates": [update] }));
}

#[test]
fn signed_out_and_refusals_are_typed() {
    let fake = FakePlatform::start();
    let signed_out = Platform::new(fake.url(), Arc::new(Token(None))).unwrap();
    assert_eq!(signed_out.me().unwrap_err().kind, ErrorKind::SignedOut);
    let stale = Platform::new(fake.url(), Arc::new(Token(Some("stale")))).unwrap();
    assert_eq!(stale.preferences().unwrap_err().kind, ErrorKind::SignedOut);
    fake.state().fail_next = Some((503, "SERVICE_UNAVAILABLE".into(), "down".into()));
    assert_eq!(
        client(&fake).notifications().unwrap_err().kind,
        ErrorKind::Failed
    );
}
