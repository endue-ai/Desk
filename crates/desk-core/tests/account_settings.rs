//! account.settings.* (ADR 0130): the signed-in account's own settings on endue, against the
//! in-process fake platform of desk-platform. Every call needs account:manage; a desk without an
//! endue ID, or a signed-out one, sends nothing; a part endue does not answer for is a problem, not
//! a failure; a change reaches endue in its own shapes, comes back as the settings now, and a new
//! name reaches account.status.

mod support;

use std::fs;
use std::sync::Arc;
use std::time::Duration;

use desk_bridge::ErrorCode;
use desk_core::account::{Account, AccountOptions, NetIdClient};
use desk_core::{Core, studio_tokens};
use desk_platform::Platform;
use desk_platform::fake::FakePlatform;
use serde_json::{Value, json};
use support::*;

/// An account on `fake` (its users/me is the profile's source too), signed in with `token`.
fn account(tag: &str, fake: &FakePlatform, token: Option<&str>) -> Arc<Account> {
    let dir = home(tag).join("data");
    fs::create_dir_all(&dir).unwrap();
    let file = dir.join("account.json");
    if let Some(token) = token {
        let saved = json!({ "version": 2, "note": "test", "accessToken": token,
            "refreshCookie": "rt-1", "issuedAt": 1_767_225_300_u64, "expiresAt": 4_102_444_800_u64 });
        fs::write(&file, saved.to_string()).unwrap();
    }
    let mut options = AccountOptions::new(fake.url(), "http://127.0.0.1:9");
    options.file = Some(file);
    options.retry = vec![Duration::from_millis(5); 3];
    Account::open(options, NetIdClient)
}

fn desk(tag: &str, fake: &FakePlatform, token: Option<&str>) -> (Core, Arc<Account>) {
    let account = account(tag, fake, token);
    let platform = Platform::new(fake.url(), studio_tokens(&account)).unwrap();
    let core = Core::new(roots(&home(tag)))
        .with_account(Arc::clone(&account))
        .with_platform(platform);
    grant(&core, "desk", json!({ "permission": "account:manage" }));
    (core, account)
}

fn settings(
    core: &Core,
    method: &str,
    mut params: Value,
) -> Result<Value, desk_bridge::BridgeError> {
    params["scope"] = json!({ "permission": "account:manage" });
    call(core, "desk", method, params)
}

fn get(core: &Core) -> Value {
    settings(core, "account.settings.get", json!({})).unwrap()
}

#[test]
fn nothing_is_sent_without_the_grant_an_account_or_a_session() {
    let fake = FakePlatform::start();
    let (core, _) = desk("settings-grant", &fake, Some("token-1"));
    let stranger = call(
        &core,
        "endue.notes",
        "account.settings.get",
        json!({ "scope": { "permission": "account:manage" } }),
    );
    assert_eq!(stranger.unwrap_err().code, ErrorCode::PermissionDenied);

    let bare = Core::new(roots(&home("settings-bare")));
    grant(&bare, "desk", json!({ "permission": "account:manage" }));
    let error = settings(&bare, "account.settings.get", json!({})).unwrap_err();
    assert_eq!(error.code, ErrorCode::Unsupported);

    let (signed_out, _) = desk("settings-out", &fake, None);
    for (method, params) in [
        ("account.settings.get", json!({})),
        ("account.settings.update", json!({ "displayName": "Ada" })),
    ] {
        let error = settings(&signed_out, method, params).unwrap_err();
        assert_eq!(error.code, ErrorCode::SignedOut, "{method}");
        assert!(error.message.contains("Sign in"), "{}", error.message);
    }
    assert!(fake.seen().is_empty(), "nothing reached endue");
}

#[test]
fn the_settings_are_the_account_its_preferences_and_five_kinds() {
    let fake = FakePlatform::start();
    {
        let mut state = fake.state();
        state.account.preferences["locale"] = json!("en-US");
        state.account.preferences["timezone"] = json!("Asia/Seoul");
        state
            .account
            .notifications
            .get_mut("routine_completed")
            .unwrap()["in_app"] = json!(false);
    }
    let (core, _) = desk("settings-get", &fake, Some("token-1"));
    let got = get(&core);
    assert_eq!(got["user"]["email"], "ada@example.com");
    assert_eq!(got["user"]["displayName"], "Ada");
    assert_eq!(got["user"]["status"], "active");
    assert_eq!(got["user"]["joinedAt"], "2026-03-14T09:00:00Z");
    assert!(got["user"].get("avatarUrl").is_none());
    assert_eq!(got["language"], "en-US");
    assert_eq!(got["timeZone"], "Asia/Seoul");
    let kinds: Vec<(&str, bool)> = got["notifications"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| (n["kind"].as_str().unwrap(), n["inApp"].as_bool().unwrap()))
        .collect();
    assert_eq!(
        kinds,
        [
            ("conversation-reply", true),
            ("routine-completed", false),
            ("routine-failed", true),
            ("routine-skipped", true),
            ("agent-notice", true),
        ]
    );
    assert_eq!(got["problems"], json!([]));
    let seen = fake.seen_at("GET", "/api/v1/users/me/preferences");
    assert_eq!(seen[0].headers["authorization"], "Bearer token-1");
}

#[test]
fn a_part_endue_does_not_answer_for_is_a_problem() {
    let fake = FakePlatform::start();
    {
        let mut state = fake.state();
        // endue stores a language unchecked; one the bridge cannot take is left out.
        state.account.preferences["locale"] = json!("english");
        let down = (
            503,
            "SERVICE_UNAVAILABLE".to_owned(),
            "notifications are down".to_owned(),
        );
        state
            .fail_at
            .insert("/api/v1/notifications/preferences".to_owned(), down);
    }
    let (core, _) = desk("settings-problem", &fake, Some("token-1"));
    let got = get(&core);
    assert!(got.get("language").is_none());
    assert_eq!(got["timeZone"], "America/New_York");
    assert_eq!(got["notifications"], json!([]));
    assert_eq!(got["problems"][0]["part"], "notifications");
    assert_eq!(got["problems"][0]["code"], "io_error");

    // The account itself must answer.
    let gone = (
        503,
        "SERVICE_UNAVAILABLE".to_owned(),
        "users are down".to_owned(),
    );
    fake.state()
        .fail_at
        .insert("/api/v1/users/me".to_owned(), gone);
    let error = settings(&core, "account.settings.get", json!({})).unwrap_err();
    assert_eq!(error.code, ErrorCode::IoError);
}

#[test]
fn a_change_reaches_endue_and_the_account_bar() {
    let fake = FakePlatform::start();
    fake.state().account.user["avatar_url"] = json!("https://cdn.example.com/ada.png");
    let (core, account) = desk("settings-update", &fake, Some("token-1"));
    let changed = settings(
        &core,
        "account.settings.update",
        json!({
            "displayName": "  Ada Lovelace ",
            "avatarUrl": "",
            "language": "ja-JP",
            "timeZone": "Europe/London",
            "notifications": [{ "kind": "agent-notice", "inApp": false }]
        }),
    )
    .unwrap();
    assert_eq!(changed["user"]["displayName"], "Ada Lovelace");
    assert!(changed["user"].get("avatarUrl").is_none());
    assert_eq!(changed["language"], "ja-JP");
    assert_eq!(changed["timeZone"], "Europe/London");
    assert_eq!(
        changed["notifications"][4],
        json!({ "kind": "agent-notice", "inApp": false })
    );

    let sent = |method: &str, path: &str| fake.seen_at(method, path)[0].body.clone();
    assert_eq!(
        sent("PATCH", "/api/v1/users/me"),
        json!({ "display_name": "Ada Lovelace", "avatar_url": "" })
    );
    assert_eq!(
        sent("PATCH", "/api/v1/users/me/preferences"),
        json!({ "locale": "ja-JP", "timezone": "Europe/London" })
    );
    assert_eq!(
        sent("PUT", "/api/v1/notifications/preferences"),
        json!({ "updates": [{ "notification_type": "agent_notice", "channel": "in_app", "enabled": false }] })
    );
    // What a change answered is not read again.
    assert!(
        fake.seen_at("GET", "/api/v1/users/me/preferences")
            .is_empty()
    );

    // The account bar's profile follows the new name.
    let mut shown = None;
    for _ in 0..500 {
        shown = account.status().profile.and_then(|p| p.display_name);
        if shown.as_deref() == Some("Ada Lovelace") {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(shown.as_deref(), Some("Ada Lovelace"));

    // Only what is given changes: the language alone sends no profile change.
    let before = fake.seen_at("PATCH", "/api/v1/users/me").len();
    settings(
        &core,
        "account.settings.update",
        json!({ "language": "fr-FR" }),
    )
    .unwrap();
    assert_eq!(fake.seen_at("PATCH", "/api/v1/users/me").len(), before);
}

#[test]
fn a_value_endue_would_store_wrongly_is_refused_before_it_is_sent() {
    let fake = FakePlatform::start();
    let (core, _) = desk("settings-invalid", &fake, Some("token-1"));
    for params in [
        json!({ "displayName": "   " }),
        json!({ "displayName": "a".repeat(201) }),
        json!({ "avatarUrl": "file:///Users/ada/me.png" }),
        json!({ "language": "english" }),
        json!({ "timeZone": "+09:00" }),
        json!({ "notifications": [] }),
        json!({}),
    ] {
        let error = settings(&core, "account.settings.update", params.clone()).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidParams, "{params}");
    }
    assert!(fake.seen().is_empty());

    // endue refusing a change stops there: what was saved before it stays saved.
    let refused = (400, "BAD_REQUEST".to_owned(), "no".to_owned());
    fake.state()
        .fail_at
        .insert("/api/v1/users/me/preferences".to_owned(), refused);
    let error = settings(
        &core,
        "account.settings.update",
        json!({ "displayName": "Grace", "timeZone": "UTC" }),
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidParams);
    assert_eq!(fake.state().account.user["display_name"], "Grace");
}
