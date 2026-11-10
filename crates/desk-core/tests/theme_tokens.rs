//! theme.tokens (ADR 0145): the runtime hands the core the look in force, and the core keeps it as the
//! flat token table the compositor draws the desk's chrome from. The tables are the bridge's vectors,
//! the ones the runtime's own test says it sends for the endue theme.

mod support;

use std::path::PathBuf;
use std::time::Duration;

use desk_bridge::{ErrorCode, ThemeContrast, ThemeScheme};
use desk_core::Core;
use serde_json::{Value, json};
use support::{NOTES, call, grant, home, roots};

const RUNTIME: &str = "desk";

fn vector(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../specs/bridge/v0/vectors/valid")
        .join(name);
    let doc: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    doc["instance"]["params"].clone()
}

fn desk(tag: &str) -> Core {
    let core = Core::new(roots(&home(tag)));
    grant(&core, RUNTIME, json!({ "permission": "theme:manage" }));
    core
}

fn send(core: &Core, caller: &str, params: Value) -> Result<Value, desk_bridge::BridgeError> {
    call(core, caller, "theme.tokens", params)
}

#[test]
fn before_the_runtime_sends_a_look_the_table_is_empty() {
    let core = desk("tokens-empty");
    let table = core.theme_tokens();
    assert_eq!(table.revision, 0);
    assert!(table.tokens.is_empty());
    assert_eq!(table.scheme, ThemeScheme::Dark);
}

#[test]
fn the_core_keeps_the_look_in_force_whole() {
    let core = desk("tokens-keep");
    let dark = vector("theme-tokens-request.json");
    let answer = send(&core, RUNTIME, dark.clone()).unwrap();
    let count = dark["tokens"].as_object().unwrap().len();
    assert_eq!(answer, json!({ "revision": 1, "tokens": count }));
    let table = core.theme_tokens();
    assert_eq!(table.revision, 1);
    assert_eq!(table.scheme, ThemeScheme::Dark);
    assert_eq!(table.contrast, ThemeContrast::Normal);
    assert!(!table.reduced_motion);
    assert_eq!((table.theme.as_str(), table.design.as_str()), ("", ""));
    assert_eq!(table.tokens.len(), count);
    assert_eq!(table.get("radiusLg"), Some("12px"));
    // References stay as the runtime sent them: the compositor follows them.
    assert_eq!(table.get("toastRadius"), Some("var(--desk-radius-lg)"));
    assert_eq!(table.get("missing"), None);
}

#[test]
fn the_same_look_again_changes_nothing_and_watchers_hear_each_new_one() {
    let core = desk("tokens-watch");
    let heard = core.watch_theme_tokens();
    let dark = vector("theme-tokens-request.json");
    let amber = vector("theme-tokens-request-amber.json");
    assert_eq!(send(&core, RUNTIME, dark.clone()).unwrap()["revision"], 1);
    assert_eq!(send(&core, RUNTIME, dark).unwrap()["revision"], 1);
    assert_eq!(send(&core, RUNTIME, amber).unwrap()["revision"], 2);
    let first = heard.recv_timeout(Duration::from_secs(1)).unwrap();
    let second = heard.recv_timeout(Duration::from_secs(1)).unwrap();
    assert_eq!((first.revision, first.theme.as_str()), (1, ""));
    assert_eq!(
        (second.revision, second.theme.as_str()),
        (2, "endue.theme-amber")
    );
    assert_eq!(second.get("radiusLg"), Some("0px"));
    assert!(
        heard.try_recv().is_err(),
        "the repeated table is not announced"
    );
    assert_eq!(core.theme_tokens().revision, 2);
}

#[test]
fn only_a_holder_of_theme_manage_hands_over_a_look() {
    let core = desk("tokens-refused");
    let refused = send(&core, NOTES, vector("theme-tokens-request.json")).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied);
    assert_eq!(core.theme_tokens().revision, 0);
}

#[test]
fn a_table_the_spec_cannot_carry_is_refused_and_the_last_one_stays() {
    let core = desk("tokens-invalid");
    send(&core, RUNTIME, vector("theme-tokens-request.json")).unwrap();
    let mut named = vector("theme-tokens-request-light.json");
    named["tokens"]["--desk-text"] = json!("#000000");
    let mut long = vector("theme-tokens-request-light.json");
    long["tokens"]["text"] = json!("x".repeat(1025));
    let mut many = vector("theme-tokens-request-light.json");
    for n in 0..1024 {
        many["tokens"][format!("extra{n}")] = json!("1px");
    }
    for params in [named, long, many] {
        let refused = send(&core, RUNTIME, params).unwrap_err();
        assert_eq!(
            refused.code,
            ErrorCode::InvalidParams,
            "{}",
            refused.message
        );
    }
    let table = core.theme_tokens();
    assert_eq!((table.revision, table.scheme), (1, ThemeScheme::Dark));
}
