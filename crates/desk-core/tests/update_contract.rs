//! The update.* contract (ADR 0054) before the updater exists: every method deserializes as a bridge
//! request under an `update:manage` scope, is checked like any call, and answers `unsupported`; only
//! an `update:manage` grant covers it.

mod support;

use desk_bridge::ErrorCode;
use desk_core::Core;
use serde_json::{Value, json};
use support::*;

const METHODS: [&str; 4] = [
    "update.status",
    "update.check",
    "update.download",
    "update.apply",
];

fn manage() -> Value {
    json!({ "permission": "update:manage" })
}

fn code(core: &Core, caller: &str, method: &str) -> ErrorCode {
    call(core, caller, method, json!({ "scope": manage() }))
        .expect_err("no build updates itself yet")
        .code
}

#[test]
fn every_update_method_answers_unsupported_until_the_core_serves_it() {
    let core = Core::new(roots(&home("update-contract")));
    grant(&core, "desk", manage());
    for method in METHODS {
        let error = call(&core, "desk", method, json!({ "scope": manage() }))
            .expect_err("no build updates itself yet");
        assert_eq!(error.code, ErrorCode::Unsupported, "{method}");
        assert!(
            error.message.contains(method),
            "{method}: {}",
            error.message
        );
    }
}

#[test]
fn update_manage_covers_only_itself() {
    let core = Core::new(roots(&home("update-covers")));
    grant(
        &core,
        "example.manager",
        json!({ "permission": "plugin:manage" }),
    );
    grant(
        &core,
        "example.manager",
        json!({ "permission": "perm:manage" }),
    );
    grant(
        &core,
        "example.manager",
        json!({ "permission": "cmd:invoke", "ids": ["*"] }),
    );
    for method in METHODS {
        assert_eq!(
            code(&core, "example.nobody", method),
            ErrorCode::PermissionDenied,
            "{method}"
        );
        assert_eq!(
            code(&core, "example.manager", method),
            ErrorCode::PermissionDenied,
            "{method}"
        );
    }
    grant(&core, "example.manager", manage());
    for method in METHODS {
        assert_eq!(
            code(&core, "example.manager", method),
            ErrorCode::Unsupported,
            "{method}"
        );
    }
}
