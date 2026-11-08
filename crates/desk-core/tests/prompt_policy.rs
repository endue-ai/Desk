//! The core's prompt policy (CORE-03): identical requests share one prompt and one answer, a refusal
//! is remembered for its caller and scope until a grant covers it, and a caller's third folder under
//! one parent offers the parent. Prompts go to `desk`, which holds perm:manage; the Prompter is never
//! asked. Every prompt a test causes is answered, so no request is left waiting.

mod support;

use std::sync::mpsc::Receiver;
use std::sync::{Barrier, Mutex};
use std::time::Duration;

use desk_bridge::{BridgeError, BridgeRequest, BridgeResponse, ErrorCode};
use desk_core::{Core, Delivery};
use desk_sys::shell::Opener;
use serde_json::{Value, json};
use support::*;

const IMAGES: &str = "example.images";
/// The caller id #337 gives agents: the policy keys on any caller id.
const AGENT: &str = "agent:helper";

fn prompted(tag: &str) -> (Core, Receiver<Delivery>) {
    let core = Core::new(roots(&home(tag))).with_prompter(NeverAsk);
    grant(&core, "desk", manage());
    let deliveries = core.events().subscribe_addressed();
    (core, deliveries)
}

fn read(path: &str) -> Value {
    json!({ "permission": "fs:read", "paths": [path] })
}

fn yes() -> Value {
    json!({ "granted": true })
}

fn no() -> Value {
    json!({ "granted": false })
}

fn request(core: &Core, caller: &str, permission: &Value) -> Result<Value, BridgeError> {
    let params = json!({ "permission": permission, "reason": "To show your files" });
    call(core, caller, "perm.request", params)
}

/// perm.answer as `desk` with `decision`. An answer the bridge cannot parse fails as `unsupported`
/// instead of panicking, so a waiting request is still answered after it.
fn answer(core: &Core, prompt: &Value, decision: Value) -> Result<Value, BridgeError> {
    let mut params = decision;
    params["promptId"] = prompt["promptId"].clone();
    params["scope"] = manage();
    let request = json!({ "id": 1, "method": "perm.answer", "params": params });
    match serde_json::from_value::<BridgeRequest>(request) {
        Ok(request) => match core.handle("desk", request) {
            BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
            BridgeResponse::BridgeFailure(failed) => Err(failed.error),
        },
        Err(e) => Err(BridgeError {
            code: ErrorCode::Unsupported,
            message: format!("perm.answer does not parse: {e}"),
            permission: None,
        }),
    }
}

/// `count` copies of `ask`, started together on threads of their own. Every perm.prompt they cause
/// is answered with `decide(prompt)`, or refused when that answer fails, once the others have had
/// time to join a waiting prompt. Returns each answer and the prompts seen, in order.
fn answering(
    core: &Core,
    deliveries: &Receiver<Delivery>,
    count: usize,
    ask: impl Fn() -> Result<Value, BridgeError> + Sync,
    decide: impl Fn(&Value) -> Value,
) -> (Vec<Result<Value, BridgeError>>, Vec<Value>) {
    let start = Barrier::new(count);
    std::thread::scope(|s| {
        let asking: Vec<_> = (0..count)
            .map(|_| {
                s.spawn(|| {
                    start.wait();
                    ask()
                })
            })
            .collect();
        let mut prompts: Vec<Value> = Vec::new();
        loop {
            let finished = asking.iter().all(|a| a.is_finished());
            let mut arrived = drain(deliveries);
            if count > 1 && prompts.is_empty() && arrived.iter().any(|d| d.name() == "perm.prompt")
            {
                std::thread::sleep(Duration::from_millis(300));
                arrived.extend(drain(deliveries));
            }
            for prompt in arrived.iter().filter(|d| d.name() == "perm.prompt") {
                let data = prompt.data().clone();
                if answer(core, &data, decide(&data)).is_err() {
                    let _ = answer(core, &data, no());
                }
                prompts.push(data);
            }
            if finished {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        let answers = asking.into_iter().map(|a| a.join().unwrap()).collect();
        (answers, prompts)
    })
}

/// One request, every prompt answered with `decision`.
fn ask(
    core: &Core,
    deliveries: &Receiver<Delivery>,
    caller: &str,
    permission: &Value,
    decision: Value,
) -> (Value, Vec<Value>) {
    let asked = || request(core, caller, permission);
    let (mut answers, prompts) = answering(core, deliveries, 1, asked, |_| decision.clone());
    (answers.remove(0).unwrap(), prompts)
}

#[test]
fn identical_pending_requests_share_one_prompt_and_one_answer() {
    let (core, deliveries) = prompted("policy-together");
    let documents = read("~/Documents/**");
    let asked = || request(&core, NOTES, &documents);
    let (answers, prompts) = answering(&core, &deliveries, 5, asked, |_| yes());
    assert_eq!(
        prompts.len(),
        1,
        "one prompt for five requests: {prompts:?}"
    );
    let grant = answers[0].as_ref().unwrap()["grant"].clone();
    assert_eq!(grant["duration"], "session");
    for answer in answers {
        assert_eq!(answer.unwrap(), json!({ "granted": true, "grant": grant }));
    }
    assert_eq!(query(&core, NOTES), vec![grant]);
}

#[test]
fn a_once_answer_gives_each_request_answered_together_its_own_grant() {
    let (core, deliveries) = prompted("policy-together-once");
    let documents = read("~/Documents/**");
    let asked = || request(&core, NOTES, &documents);
    let once = |_: &Value| json!({ "granted": true, "duration": "once" });
    let (answers, prompts) = answering(&core, &deliveries, 5, asked, once);
    assert_eq!(prompts.len(), 1, "{prompts:?}");
    let mut ids: Vec<Value> = answers
        .into_iter()
        .map(|answer| {
            let grant = answer.unwrap()["grant"].clone();
            assert_eq!(grant["duration"], "once");
            grant["grantId"].clone()
        })
        .collect();
    ids.sort_by_key(|id| id.to_string());
    ids.dedup();
    assert_eq!(ids.len(), 5, "one call each");
    for _ in 0..5 {
        read_hello(&core, NOTES).unwrap();
    }
    assert_eq!(
        read_hello(&core, NOTES).unwrap_err().code,
        ErrorCode::PermissionDenied
    );
}

#[test]
fn a_refusal_is_remembered_for_that_caller_and_scope() {
    let (core, deliveries) = prompted("policy-refused");
    let documents = read("~/Documents/**");
    let asked = || request(&core, NOTES, &documents);
    let (answers, prompts) = answering(&core, &deliveries, 5, asked, |_| no());
    assert_eq!(prompts.len(), 1, "{prompts:?}");
    for answer in answers {
        assert_eq!(answer.unwrap()["granted"], false);
    }

    // The same caller asking the same scope is refused at once: nobody is asked.
    let (again, prompts) = ask(&core, &deliveries, NOTES, &documents, yes());
    assert_eq!(
        again,
        json!({ "granted": false, "reason": "refused-earlier" })
    );
    assert!(prompts.is_empty(), "{prompts:?}");

    // Another caller and another scope are asked as before.
    let (other, prompts) = ask(&core, &deliveries, AGENT, &documents, yes());
    assert_eq!((&other["granted"], prompts.len()), (&json!(true), 1));
    assert_eq!(prompts[0]["caller"], AGENT);
    let calendar = read("~/Calendar/**");
    let (wider, prompts) = ask(&core, &deliveries, NOTES, &calendar, yes());
    assert_eq!((&wider["granted"], prompts.len()), (&json!(true), 1));
}

#[test]
fn a_grant_that_covers_a_refused_scope_ends_the_refusal() {
    let (core, deliveries) = prompted("policy-unrefused");
    let documents = read("~/Documents/**");
    ask(&core, &deliveries, NOTES, &documents, no());
    let (refused, _) = ask(&core, &deliveries, NOTES, &documents, yes());
    assert_eq!(refused["reason"], "refused-earlier");

    // The person grants NOTES the whole home folder, which covers the refused scope.
    let (everything, prompts) = ask(&core, &deliveries, NOTES, &read("~/**"), yes());
    assert_eq!((&everything["granted"], prompts.len()), (&json!(true), 1));
    let id = everything["grant"]["grantId"].clone();
    call(&core, NOTES, "perm.revoke", json!({ "grantId": id })).unwrap();

    let (again, prompts) = ask(&core, &deliveries, NOTES, &documents, yes());
    assert_eq!(prompts.len(), 1, "asked again, not refused earlier");
    assert_eq!(again["granted"], true);
}

/// An opener that must never be asked: every call here is refused.
struct NeverOpen;

impl Opener for NeverOpen {
    fn open_url(&self, url: &str) -> Result<(), desk_sys::Error> {
        panic!("opened {url}")
    }

    fn reveal(&self, path: &std::path::Path) -> Result<(), desk_sys::Error> {
        panic!("revealed {}", path.display())
    }
}

#[test]
fn a_call_that_asks_by_itself_is_denied_at_once_after_a_refusal() {
    let core = Core::new(roots(&home("policy-shell")))
        .with_prompter(NeverAsk)
        .with_opener(NeverOpen);
    grant(&core, "desk", manage());
    let deliveries = core.events().subscribe_addressed();
    let scope = json!({ "permission": "shell:open", "paths": ["~/Documents/**"] });
    let params = json!({ "target": "~/Documents/hello.md", "reveal": true, "scope": scope });
    let reveal = || call(&core, NOTES, "shell.open", params.clone());

    let (first, prompts) = answering(&core, &deliveries, 1, reveal, |_| no());
    assert_eq!(prompts.len(), 1);
    let first = first.into_iter().next().unwrap().unwrap_err();
    assert_eq!(first.code, ErrorCode::PermissionDenied);

    let (again, prompts) = answering(&core, &deliveries, 1, reveal, |_| no());
    assert!(prompts.is_empty(), "{prompts:?}");
    let again = again.into_iter().next().unwrap().unwrap_err();
    assert_eq!(again.code, ErrorCode::PermissionDenied);
    assert!(again.message.contains("earlier"), "{}", again.message);
}

#[test]
fn a_third_folder_under_one_parent_offers_the_parent() {
    let (core, deliveries) = prompted("policy-parent");
    let year = |year: &str| read(&format!("~/Pictures/{year}/**"));
    for asked in ["2024", "2025"] {
        let (refused, prompts) = ask(&core, &deliveries, IMAGES, &year(asked), no());
        assert_eq!((&refused["granted"], prompts.len()), (&json!(false), 1));
        assert!(prompts[0].get("parent").is_none(), "{prompts:?}");
    }
    // Asking a refused folder again counts no new folder.
    ask(&core, &deliveries, IMAGES, &year("2024"), no());

    let parent = |prompt: &Value| match prompt.get("parent") {
        Some(_) => json!({ "granted": true, "parent": true }),
        None => yes(),
    };
    let third = || request(&core, IMAGES, &year("2026"));
    let (mut answers, prompts) = answering(&core, &deliveries, 1, third, parent);
    assert_eq!(prompts.len(), 1);
    assert_eq!(prompts[0]["permission"], year("2026"));
    assert_eq!(prompts[0]["parent"], read("~/Pictures/**"));
    let granted = answers.remove(0).unwrap();
    assert_eq!(granted["grant"]["permission"], read("~/Pictures/**"));
    assert_eq!(granted["grant"]["duration"], "session");

    // The parent covers every folder under it, the refused ones too.
    for asked in ["2027", "2024"] {
        let (covered, prompts) = ask(&core, &deliveries, IMAGES, &year(asked), no());
        assert!(prompts.is_empty(), "{prompts:?}");
        assert_eq!(covered, granted);
    }
}

#[test]
fn the_parent_is_offered_per_caller_and_permission_and_never_for_a_root_or_the_home() {
    let home = home("policy-parent-limits");
    let core = Core::new(roots(&home)).with_prompter(NeverAsk);
    grant(&core, "desk", manage());
    let deliveries = core.events().subscribe_addressed();
    let offered = |caller: &str, permission: Value| {
        let (_, prompts) = ask(&core, &deliveries, caller, &permission, no());
        assert_eq!(prompts.len(), 1, "{permission}: {prompts:?}");
        prompts[0].get("parent").cloned()
    };
    let write = |path: &str| json!({ "permission": "fs:write", "paths": [path] });

    // Two folders of IMAGES, one of another caller and one to write: nothing to offer yet.
    assert_eq!(offered(IMAGES, read("~/Pictures/a/**")), None);
    assert_eq!(offered(IMAGES, read("~/Pictures/b/**")), None);
    assert_eq!(offered(AGENT, read("~/Pictures/c/**")), None);
    assert_eq!(offered(IMAGES, write("~/Pictures/c/**")), None);
    // Straight under the home folder, by name or by path, or under a folder that holds it: never.
    for name in ["a", "b", "c"] {
        assert_eq!(offered(IMAGES, read(&format!("~/{name}/**"))), None);
        let under_home = format!("{}/{name}/**", home.display());
        assert_eq!(offered(IMAGES, read(&under_home)), None);
        let above = home.parent().unwrap().join(format!("x-{name}"));
        assert_eq!(
            offered(IMAGES, read(&format!("{}/**", above.display()))),
            None
        );
    }

    // The third fs:read folder of IMAGES under ~/Pictures offers it, until the person refuses it.
    let pictures = Some(read("~/Pictures/**"));
    assert_eq!(offered(IMAGES, read("~/Pictures/c/**")), pictures);
    assert_eq!(offered(IMAGES, read("~/Pictures/**")), None);
    assert_eq!(offered(IMAGES, read("~/Pictures/d/**")), None);
}

#[test]
fn an_answer_for_a_parent_that_was_not_offered_is_invalid() {
    let (core, deliveries) = prompted("policy-parent-invalid");
    let documents = read("~/Documents/**");
    let tried = Mutex::new(Vec::new());
    let asked = || request(&core, NOTES, &documents);
    let (mut answers, prompts) = answering(&core, &deliveries, 1, asked, |prompt| {
        let widened = answer(&core, prompt, json!({ "granted": true, "parent": true }));
        tried.lock().unwrap().push(widened.map_err(|e| e.code));
        yes()
    });
    assert_eq!(prompts.len(), 1);
    assert_eq!(
        tried.into_inner().unwrap(),
        vec![Err(ErrorCode::InvalidParams)]
    );
    let granted = answers.remove(0).unwrap();
    assert_eq!(
        granted["grant"]["permission"], documents,
        "still waiting, then answered"
    );
}

#[test]
fn brain_ask_theme_manage_and_update_manage_take_the_same_policy() {
    let (core, deliveries) = prompted("policy-newer");
    for name in ["brain:ask", "theme:manage", "update:manage"] {
        let permission = json!({ "permission": name });
        let (refused, prompts) = ask(&core, &deliveries, NOTES, &permission, no());
        assert_eq!((&refused["granted"], prompts.len()), (&json!(false), 1));
        assert!(prompts[0].get("parent").is_none(), "{prompts:?}");
        let (again, prompts) = ask(&core, &deliveries, NOTES, &permission, yes());
        let earlier = json!({ "granted": false, "reason": "refused-earlier" });
        assert_eq!((again, prompts.len()), (earlier, 0), "{name}");

        // Granted to another caller for the session, it answers that caller's next request.
        let (granted, prompts) = ask(&core, &deliveries, AGENT, &permission, yes());
        assert_eq!((&granted["granted"], prompts.len()), (&json!(true), 1));
        let (covered, prompts) = ask(&core, &deliveries, AGENT, &permission, no());
        assert_eq!((covered, prompts.len()), (granted, 0), "{name}");
    }
}
