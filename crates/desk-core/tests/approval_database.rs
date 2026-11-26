//! The built-in Database may reuse a review of the exact pending destructive command.

mod support;

use std::path::Path;

use desk_bridge::ErrorCode;
use desk_core::Core;
use serde_json::{Value, json};
use support::*;

const DATABASE: &str = "endue.database";
const AGENT: &str = "agent:mira";
const DROP: &str = "endue.database.drop-object";

#[test]
fn only_the_reviewed_builtin_database_call_with_a_complete_target_carries_approval() {
    for (built_in, complete, expected) in [
        (true, true, true),
        (true, false, false),
        (false, true, false),
    ] {
        let home = home("database-operation-review");
        let core = Core::new(roots(&home)).with_prompter(NeverAsk);
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../plugins/database");
        assert_eq!(core.install_plugin(&dir, built_in).id, DATABASE);
        call(
            &core,
            DATABASE,
            "cmd.register",
            json!({ "id": DROP, "title": "Drop an object" }),
        )
        .unwrap();
        grant(&core, "desk", manage());
        let scope = json!({ "permission": "cmd:invoke", "ids": [DROP] });
        grant(&core, AGENT, scope.clone());
        let args = if complete {
            json!({ "connection": "example", "schema": "public", "name": "sample", "kind": "table" })
        } else {
            json!({ "connection": "example" })
        };
        let invoke = |caller: &str| {
            call(
                &core,
                caller,
                "cmd.invoke",
                json!({ "id": DROP, "args": args, "scope": scope }),
            )
        };
        let deliveries = core.events().subscribe_addressed();
        if built_in && !complete {
            assert_eq!(invoke(AGENT).unwrap_err().code, ErrorCode::InvalidParams);
            assert!(named(&deliveries, "perm.approval").is_empty());
            continue;
        }
        let (review, invoked) = held(&core, &deliveries, "once", || invoke(AGENT));
        assert_eq!(review.data()["target"], DROP);
        let id = invoked.unwrap()["invocationId"].clone();
        let event = wait_for(&deliveries, "cmd.invoked");
        assert_eq!(event.data()["invocationId"], id);
        assert_eq!(
            event.data().get("approved").and_then(Value::as_bool),
            expected.then_some(true),
        );
    }
}
