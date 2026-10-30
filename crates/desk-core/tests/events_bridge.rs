//! events.subscribe and events.unsubscribe, the recipients of addressed events, and the perm and
//! events methods the core now serves instead of answering `unsupported`.

mod support;

use desk_bridge::{BridgeError, BridgeEvent, ErrorCode};
use desk_core::Core;
use serde_json::{Value, json};
use support::*;

const WATCHER: &str = "example.watcher";
const HELLO: &str = "example.hello";

fn events_scope(names: &[&str]) -> Value {
    json!({ "permission": "events:subscribe", "names": names })
}

fn subscribe(core: &Core, caller: &str, names: &[&str]) -> Result<Value, BridgeError> {
    call(
        core,
        caller,
        "events.subscribe",
        json!({ "names": names, "scope": events_scope(names) }),
    )
}

fn unsubscribe(core: &Core, caller: &str, id: &Value) -> Result<Value, BridgeError> {
    call(
        core,
        caller,
        "events.unsubscribe",
        json!({ "subscriptionId": id }),
    )
}

/// A core with example.hello installed and `desk` holding plugin:manage and cmd:invoke `*`.
fn desk(tag: &str) -> Core {
    let home = home(tag);
    let core = Core::new(roots(&home));
    install_hello(&core, &home);
    grant(&core, "desk", plugin_manage());
    grant(
        &core,
        "desk",
        json!({ "permission": "cmd:invoke", "ids": ["*"] }),
    );
    core
}

/// example.hello provides `example.hello.wave`; `desk` invokes it and example.hello answers.
fn wave(core: &Core) {
    call(
        core,
        HELLO,
        "cmd.register",
        json!({ "id": "example.hello.wave", "title": "Wave" }),
    )
    .unwrap();
    let invoked = call(
        core,
        "desk",
        "cmd.invoke",
        json!({ "id": "example.hello.wave",
                "scope": { "permission": "cmd:invoke", "ids": ["*"] } }),
    )
    .unwrap();
    call(
        core,
        HELLO,
        "cmd.answer",
        json!({ "invocationId": invoked["invocationId"], "result": "hi" }),
    )
    .unwrap();
}

#[test]
fn no_perm_or_events_method_answers_unsupported() {
    let core = Core::new(roots(&home("events-served")));
    let ask = |duration: &str| json!({ "permission": notes_read(), "reason": "To open your notes", "duration": duration });
    let calls = [
        ("perm.request", ask("once")),
        ("perm.request", ask("session")),
        ("perm.request", ask("always")),
        ("perm.query", json!({})),
        ("perm.revoke", json!({ "grantId": "g1" })),
        ("perm.revoke", json!({ "grantId": "g1", "scope": manage() })),
        ("perm.list", json!({ "scope": manage() })),
        (
            "perm.answer",
            json!({ "promptId": "p-1", "granted": true, "scope": manage() }),
        ),
        (
            "events.subscribe",
            json!({ "names": ["plugin.changed"], "scope": events_scope(&["plugin.changed"]) }),
        ),
        ("events.unsubscribe", json!({ "subscriptionId": "s-1" })),
    ];
    for (method, params) in calls {
        if let Err(error) = call(&core, NOTES, method, params) {
            assert_ne!(error.code, ErrorCode::Unsupported, "{method}");
        }
    }
}

#[test]
fn subscribing_needs_a_grant_that_covers_every_name() {
    let core = Core::new(roots(&home("events-scope")));
    let denied = subscribe(&core, WATCHER, &["plugin.changed"]).unwrap_err();
    assert_eq!(denied.code, ErrorCode::PermissionDenied);
    assert_eq!(
        serde_json::to_value(denied.permission).unwrap(),
        events_scope(&["plugin.changed"])
    );

    grant(&core, WATCHER, events_scope(&["plugin.changed"]));
    let wider = call(
        &core,
        WATCHER,
        "events.subscribe",
        json!({ "names": ["plugin.changed", "cmd.changed"],
                "scope": events_scope(&["plugin.changed"]) }),
    );
    assert_eq!(wider.unwrap_err().code, ErrorCode::PermissionDenied);
    let both = subscribe(&core, WATCHER, &["plugin.changed", "cmd.changed"]);
    assert_eq!(both.unwrap_err().code, ErrorCode::PermissionDenied);
    assert_eq!(core.subscription_count(), 0);

    let subscribed = subscribe(&core, WATCHER, &["plugin.changed"]).unwrap();
    assert!(
        subscribed["subscriptionId"]
            .as_str()
            .unwrap()
            .starts_with("s-")
    );
    assert_eq!(core.subscription_count(), 1);
}

#[test]
fn a_subscriber_hears_events_about_other_callers_once_per_event() {
    let core = desk("events-once");
    let names = ["plugin.changed", "perm.changed", "cmd.invoked"];
    grant(&core, WATCHER, events_scope(&names));
    let notes = grant(&core, NOTES, notes_read());
    let first = subscribe(&core, WATCHER, &names).unwrap();
    let second = subscribe(&core, WATCHER, &names).unwrap();
    assert_ne!(first, second);
    let deliveries = core.events().subscribe_addressed();

    wave(&core);
    let seen = drain(&deliveries);
    let of = |name: &str| -> Vec<&Seen> { seen.iter().filter(|d| d.name() == name).collect() };
    assert_eq!(of("cmd.invoked").len(), 1);
    assert_eq!(of("cmd.invoked")[0].to, strings(&[HELLO, WATCHER]));
    assert_eq!(of("cmd.changed")[0].to, strings(&[HELLO]));
    assert_eq!(of("cmd.answered").len(), 1);
    assert_eq!(of("cmd.answered")[0].to, None);

    set_enabled(&core, HELLO, false);
    let plugin = named(&deliveries, "plugin.changed");
    assert_eq!(plugin.len(), 1);
    assert_eq!(plugin[0].data()["change"], "disabled");
    assert_eq!(plugin[0].to, strings(&["desk", WATCHER]));

    call(&core, NOTES, "perm.revoke", json!({ "grantId": notes })).unwrap();
    let perm = named(&deliveries, "perm.changed");
    assert_eq!(perm.len(), 1);
    assert_eq!(perm[0].to, strings(&[NOTES, WATCHER]));
}

#[test]
fn settings_changed_and_log_entry_are_accepted_but_carry_nothing_yet() {
    let core = desk("events-later");
    let names = ["settings.changed", "log.entry"];
    grant(&core, WATCHER, events_scope(&names));
    let deliveries = core.events().subscribe_addressed();
    assert!(subscribe(&core, WATCHER, &names).is_ok());
    assert_eq!(core.subscription_count(), 1);

    grant(&core, NOTES, notes_read());
    wave(&core);
    set_enabled(&core, HELLO, false);
    let seen = drain(&deliveries);
    assert!(!seen.is_empty());
    assert!(
        seen.iter().all(|d| !names.contains(&d.name())
            && !d
                .to
                .as_ref()
                .is_some_and(|to| to.contains(&WATCHER.to_owned()))),
        "nothing reaches the subscriber: {seen:?}"
    );
}

#[test]
fn unsubscribe_ends_one_subscription_and_unknown_ids_are_not_found() {
    let core = desk("events-unsubscribe");
    grant(&core, WATCHER, events_scope(&["plugin.changed"]));
    let first = subscribe(&core, WATCHER, &["plugin.changed"]).unwrap()["subscriptionId"].clone();
    let second = subscribe(&core, WATCHER, &["plugin.changed"]).unwrap()["subscriptionId"].clone();
    let deliveries = core.events().subscribe_addressed();

    assert_eq!(unsubscribe(&core, WATCHER, &first).unwrap(), json!({}));
    set_enabled(&core, HELLO, false);
    assert_eq!(
        named(&deliveries, "plugin.changed")[0].to,
        strings(&["desk", WATCHER]),
        "the other subscription still holds"
    );
    unsubscribe(&core, WATCHER, &second).unwrap();
    set_enabled(&core, HELLO, true);
    assert_eq!(
        named(&deliveries, "plugin.changed")[0].to,
        strings(&["desk"])
    );

    for id in [&first, &second, &json!("s-404")] {
        let missing = unsubscribe(&core, WATCHER, id).unwrap_err();
        assert_eq!(missing.code, ErrorCode::NotFound);
    }
    grant(&core, "example.other", events_scope(&["plugin.changed"]));
    let theirs = subscribe(&core, "example.other", &["plugin.changed"]).unwrap();
    let missing = unsubscribe(&core, WATCHER, &theirs["subscriptionId"]).unwrap_err();
    assert_eq!(missing.code, ErrorCode::NotFound);
    assert_eq!(core.subscription_count(), 1);
}

#[test]
fn subscriptions_end_when_the_grant_is_revoked_or_the_caller_unloads() {
    let core = desk("events-end");
    let held = grant(&core, WATCHER, events_scope(&["plugin.changed"]));
    subscribe(&core, WATCHER, &["plugin.changed"]).unwrap();
    assert_eq!(core.subscription_count(), 1);
    call(&core, WATCHER, "perm.revoke", json!({ "grantId": held })).unwrap();
    assert_eq!(core.subscription_count(), 0);
    let deliveries = core.events().subscribe_addressed();
    set_enabled(&core, HELLO, false);
    assert_eq!(
        named(&deliveries, "plugin.changed")[0].to,
        strings(&["desk"])
    );

    set_enabled(&core, HELLO, true);
    grant(&core, HELLO, events_scope(&["plugin.changed"]));
    subscribe(&core, HELLO, &["plugin.changed"]).unwrap();
    assert_eq!(core.subscription_count(), 1);
    set_enabled(&core, HELLO, false);
    assert_eq!(core.subscription_count(), 0);
    let deliveries = core.events().subscribe_addressed();
    set_enabled(&core, HELLO, true);
    assert_eq!(
        named(&deliveries, "plugin.changed")[0].to,
        strings(&["desk"])
    );
}

#[test]
fn subscribe_still_broadcasts_every_event() {
    let core = desk("events-broadcast");
    grant(
        &core,
        WATCHER,
        events_scope(&["plugin.changed", "cmd.invoked"]),
    );
    subscribe(&core, WATCHER, &["plugin.changed", "cmd.invoked"]).unwrap();
    let plain = core.events().subscribe();
    let addressed = core.events().subscribe_addressed();

    let notes = grant(&core, NOTES, notes_read());
    wave(&core);
    set_enabled(&core, HELLO, false);
    call(&core, NOTES, "perm.revoke", json!({ "grantId": notes })).unwrap();

    let broadcast: Vec<BridgeEvent> = plain.try_iter().collect();
    let routed: Vec<BridgeEvent> = addressed.try_iter().map(|d| d.event).collect();
    assert_eq!(broadcast, routed, "the same events in the same order");
    let names: Vec<String> = broadcast
        .iter()
        .map(|e| {
            serde_json::to_value(e).unwrap()["event"]
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect();
    for name in [
        "perm.changed",
        "cmd.changed",
        "cmd.invoked",
        "cmd.answered",
        "plugin.changed",
    ] {
        assert!(names.iter().any(|n| n == name), "{name} in {names:?}");
    }
}
