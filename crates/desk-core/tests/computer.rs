//! computer.* on desk-computer's fake (ADR 0123): every method needs computer:see or
//! computer:control and a scope's apps are enforced; an agent's act, and a plugin's act on an
//! agent's invocation, wait for the person's approval and are runs with a screenshot after them;
//! "Allow for this task" lets the same app through until the turn ends; the stop ends the running
//! and queued input; no driver, or a platform without one, is unsupported. Nothing posts real input.

#[path = "computer/agents.rs"]
mod agents;
mod common;
#[path = "computer/fake.rs"]
mod fake;
mod support;

use std::sync::Arc;
use std::time::Duration;

use desk_bridge::ErrorCode;
use desk_computer::fake::FakeComputer;
use desk_core::Core;
use fake::*;
use serde_json::{Value, json};
use support::*;

#[test]
fn every_method_needs_its_permission() {
    let (home, fake) = (home("computer-perm"), fake());
    let core = core(&home, &fake);
    let reads = [
        ("computer.permissions.status", json!({})),
        ("computer.screenshot", json!({})),
        ("computer.windows", json!({})),
        ("computer.apps.list", json!({})),
        (
            "computer.ax.tree",
            json!({ "root": { "pid": 412, "path": [] } }),
        ),
    ];
    let acts = [
        ("computer.input.click", json!({ "x": 10.0, "y": 10.0 })),
        ("computer.input.type", json!({ "text": "hi" })),
        ("computer.input.keys", json!({ "keys": ["cmd+t"] })),
        ("computer.apps.activate", json!({ "pid": 530 })),
        ("computer.stop", json!({})),
    ];
    let with = |params: &Value, scope: Value| {
        let mut params = params.clone();
        params["scope"] = scope;
        params
    };
    for (method, params) in reads.iter() {
        let refused = call(&core, PLUGIN, method, with(params, see(None))).unwrap_err();
        assert_eq!(refused.code, ErrorCode::PermissionDenied, "{method}");
        assert_eq!(
            serde_json::to_value(&refused.permission).unwrap(),
            see(None),
            "{method}"
        );
    }
    for (method, params) in acts.iter() {
        let refused = call(&core, PLUGIN, method, with(params, control(None))).unwrap_err();
        assert_eq!(refused.code, ErrorCode::PermissionDenied, "{method}");
    }
    grant(&core, PLUGIN, see(None));
    for (method, params) in reads.iter() {
        call(&core, PLUGIN, method, with(params, see(None)))
            .unwrap_or_else(|e| panic!("{method}: {e:?}"));
    }
    let still = click(&core, PLUGIN, 10.0, control(None)).unwrap_err();
    assert_eq!(
        still.code,
        ErrorCode::PermissionDenied,
        "see is not control"
    );
    assert!(fake.acts().is_empty(), "nothing acted: {:?}", fake.acts());
    grant(&core, PLUGIN, control(None));
    let done = click(&core, PLUGIN, 10.0, control(None)).unwrap();
    assert_eq!(done["app"]["bundleId"], SAFARI);
    assert_eq!(done["summary"], "click left at (10, 100) in Safari");
    assert!(
        done.get("runId").is_none(),
        "a plugin's own act is no agent's run"
    );
    assert_eq!(fake.posted().len(), 3, "a move, a press and a release");
}

#[test]
fn a_scope_limited_to_apps_reaches_only_those_apps() {
    let (home, fake) = (home("computer-apps"), fake());
    let core = core(&home, &fake);
    grant(&core, PLUGIN, see(Some(&[SAFARI])));
    grant(&core, PLUGIN, control(Some(&[SAFARI])));
    let only = see(Some(&[SAFARI]));
    let apps = call(
        &core,
        PLUGIN,
        "computer.apps.list",
        json!({ "scope": only }),
    )
    .unwrap();
    assert_eq!(apps["apps"].as_array().unwrap().len(), 1);
    assert_eq!(apps["apps"][0]["bundleId"], SAFARI);
    let windows = call(&core, PLUGIN, "computer.windows", json!({ "scope": only })).unwrap();
    assert_eq!(windows["windows"].as_array().unwrap().len(), 1);
    let other = json!({ "target": { "window": 9 }, "scope": only });
    let refused = call(&core, PLUGIN, "computer.screenshot", other).unwrap_err();
    assert_eq!(
        refused.code,
        ErrorCode::PermissionDenied,
        "TextEdit's window"
    );
    let screen = call(
        &core,
        PLUGIN,
        "computer.screenshot",
        json!({ "scope": only }),
    );
    assert_eq!(
        screen.unwrap_err().code,
        ErrorCode::PermissionDenied,
        "a whole display"
    );
    let wide = call(
        &core,
        PLUGIN,
        "computer.screenshot",
        json!({ "scope": see(None) }),
    );
    assert_eq!(
        wide.unwrap_err().code,
        ErrorCode::PermissionDenied,
        "a grant covers no wider scope"
    );

    click(&core, PLUGIN, 100.0, control(Some(&[SAFARI]))).unwrap();
    let posted = fake.posted().len();
    let textedit = click(&core, PLUGIN, 900.0, control(Some(&[SAFARI]))).unwrap_err();
    assert_eq!(
        textedit.code,
        ErrorCode::PermissionDenied,
        "the pointer is over TextEdit"
    );
    let desktop = call(
        &core,
        PLUGIN,
        "computer.input.click",
        json!({ "x": 100.0, "y": 850.0, "scope": control(Some(&[SAFARI])) }),
    );
    assert_eq!(
        desktop.unwrap_err().code,
        ErrorCode::PermissionDenied,
        "no app is under it"
    );
    let quit = json!({ "pid": 530, "scope": control(Some(&[SAFARI])) });
    let refused = call(&core, PLUGIN, "computer.apps.quit", quit).unwrap_err();
    assert_eq!(refused.code, ErrorCode::PermissionDenied);
    assert_eq!(fake.posted().len(), posted, "nothing reached TextEdit");
    assert_eq!(fake.running().len(), 2, "TextEdit still runs");
}

#[test]
fn stop_ends_the_running_and_queued_input_until_the_person_resumes() {
    let (home, fake) = (home("computer-stop"), fake());
    let core = core(&home, &fake);
    let deliveries = core.events().subscribe_addressed();
    let events = core.events().subscribe();
    grant(&core, PLUGIN, control(None));
    grant(&core, MIRA, control(None));
    let stop = |caller: &str, resume: bool| {
        call(
            &core,
            caller,
            "computer.stop",
            json!({ "resume": resume, "scope": control(None) }),
        )
    };
    let long = "a".repeat(3000);
    std::thread::scope(|s| {
        let typing = s.spawn(|| {
            call(
                &core,
                PLUGIN,
                "computer.input.type",
                json!({ "text": long, "scope": control(None) }),
            )
        });
        while fake.posted().is_empty() {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(stop(PLUGIN, false).unwrap()["stopped"], true);
        let cancelled = typing.join().unwrap().unwrap_err();
        assert_eq!(cancelled.code, ErrorCode::Cancelled);
        assert!(
            cancelled.message.contains("stopped after"),
            "{}",
            cancelled.message
        );
    });
    assert!(fake.typed().len() < 3000, "the rest never went out");
    let posted = fake.posted().len();
    let (_, queued) = held(&core, &deliveries, "once", || {
        click(&core, MIRA, 100.0, control(None))
    });
    assert_eq!(
        queued.unwrap_err().code,
        ErrorCode::Cancelled,
        "approved while stopped"
    );
    assert_eq!(
        click(&core, PLUGIN, 100.0, control(None)).unwrap_err().code,
        ErrorCode::Cancelled
    );
    assert_eq!(fake.posted().len(), posted);
    grant(&core, PLUGIN, see(None));
    let status = call(
        &core,
        PLUGIN,
        "computer.permissions.status",
        json!({ "scope": see(None) }),
    );
    assert_eq!(status.unwrap()["stopped"], true);
    assert_eq!(
        stop(MIRA, true).unwrap_err().code,
        ErrorCode::PermissionDenied,
        "an agent never resumes"
    );
    assert!(core.computer_stopped());
    assert_eq!(stop(PLUGIN, true).unwrap()["stopped"], false);
    click(&core, PLUGIN, 100.0, control(None)).unwrap();
    let activity: Vec<Value> = std::iter::from_fn(|| events.try_recv().ok())
        .map(|event| serde_json::to_value(event).unwrap())
        .filter(|event| event["event"] == "computer.activity")
        .map(|event| event["data"]["state"].clone())
        .collect();
    // The stop and the typing it ends race; the rest comes in order.
    let count = |state: &str| activity.iter().filter(|s| *s == state).count();
    let counts = ["acting", "failed", "stopped", "resumed", "done"].map(count);
    assert_eq!(counts, [4, 3, 1, 1, 1], "{activity:?}");
    let last = [json!("resumed"), json!("acting"), json!("done")];
    assert_eq!(activity[activity.len() - 3..], last, "{activity:?}");
}

#[test]
fn no_driver_or_a_platform_without_one_is_unsupported_and_no_endue_id_is_needed() {
    let home = home("computer-none");
    let status = json!({ "scope": see(None) });
    let bare = Core::new(roots(&home));
    grant(&bare, PLUGIN, see(None));
    let none = call(&bare, PLUGIN, "computer.permissions.status", status.clone()).unwrap_err();
    assert_eq!(none.code, ErrorCode::Unsupported);
    // Off macOS the OS driver answers unsupported for every call.
    #[cfg(not(target_os = "macos"))]
    {
        let elsewhere = Core::new(roots(&home)).with_computer(desk_computer::os());
        grant(&elsewhere, PLUGIN, see(None));
        let answer = call(
            &elsewhere,
            PLUGIN,
            "computer.permissions.status",
            status.clone(),
        );
        assert_eq!(answer.unwrap_err().code, ErrorCode::Unsupported);
    }
    // Signed out of endue ID: computer use is this computer's alone and needs none.
    let fake = Arc::new(FakeComputer::new().with_permissions(true, false));
    let signed_out = Core::new(roots(&home)).with_computer(fake);
    grant(&signed_out, PLUGIN, see(None));
    let now = call(&signed_out, PLUGIN, "computer.permissions.status", status).unwrap();
    assert_eq!(
        now,
        json!({ "accessibility": true, "screenRecording": false, "stopped": false })
    );
    let shot = call(
        &signed_out,
        PLUGIN,
        "computer.screenshot",
        json!({ "scope": see(None) }),
    );
    let shot = shot.unwrap_err();
    assert_eq!(
        shot.code,
        ErrorCode::PermissionDenied,
        "Screen Recording is not granted"
    );
    assert!(
        shot.message.contains("Privacy_ScreenCapture"),
        "{}",
        shot.message
    );
}
