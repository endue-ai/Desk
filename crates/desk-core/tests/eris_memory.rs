//! Eris's turns carry her memory, and she asks before she remembers (ADR 0096): every brain.say turn
//! sends the facts memory finds for the line, her newest episodes and the working context; a turn
//! that ends in words is kept as an episode; her desk-remember call waits for the person's approval
//! (ADR 0078) unless an always grant lets her remember freely. The brain is examples/brain-echo for
//! sessions and leases, with scripted turns.

mod common;
mod support;

use std::path::Path;
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::Echo;
use desk_brain::{
    Brain, BrainFailure, CreateSessionRequest, Lease, LeaseAcquireRequest, LeaseRenewRequest,
    Session, ToolResultRequest, TurnContext, TurnEvent, TurnRequest,
};
use desk_brain_endue::HttpBrain;
use desk_core::{BrainOptions, Core, Delivery};
use serde_json::{Value, json};
use support::*;

/// brain-echo, except that it keeps each turn's context and answers "remember that X" by calling
/// desk-remember with X, then "Noted." once the result is back; any other line is echoed.
struct Scripted {
    inner: HttpBrain,
    contexts: Mutex<Vec<Option<TurnContext>>>,
    results: Mutex<Vec<Value>>,
}

macro_rules! pass {
    ($($name:ident($($arg:ident: $ty:ty),*) -> $out:ty;)*) => {$(
        fn $name(&self, $($arg: $ty),*) -> Result<$out, BrainFailure> {
            self.inner.$name($($arg),*)
        }
    )*};
}

fn event(value: Value) -> TurnEvent {
    serde_json::from_value(value).unwrap()
}

impl Brain for Scripted {
    pass! {
        create_session(request: &CreateSessionRequest) -> Session;
        get_session(session: &str) -> Session;
        get_lease(session: &str) -> Lease;
        acquire_lease(session: &str, request: &LeaseAcquireRequest) -> Lease;
        renew_lease(session: &str, lease: &str, request: &LeaseRenewRequest) -> Lease;
        release_lease(session: &str, lease: &str) -> ();
    }
    fn create_turn(
        &self,
        _: &str,
        request: &TurnRequest,
        on: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        self.contexts.lock().unwrap().push(request.context.clone());
        let text = request.message.content[0].text.clone();
        on(event(json!({ "type": "turn.started", "turnId": "turn1" })));
        if let Some(fact) = text.strip_prefix("remember that ") {
            let offered = request
                .tools
                .iter()
                .flatten()
                .any(|t| t.name == "desk-remember");
            assert!(offered, "a desk with memory offers desk-remember");
            on(event(
                json!({ "type": "tool.call", "turnId": "turn1", "call": {
                "callId": "c1", "name": "desk-remember", "arguments": { "text": fact } } }),
            ));
            on(event(
                json!({ "type": "turn.completed", "turnId": "turn1", "stopReason": "tool_call" }),
            ));
            return Ok(());
        }
        on(event(
            json!({ "type": "text.delta", "turnId": "turn1", "text": format!("echo: {text}") }),
        ));
        on(event(
            json!({ "type": "turn.completed", "turnId": "turn1", "stopReason": "end_turn" }),
        ));
        Ok(())
    }
    fn submit_tool_result(
        &self,
        _: &str,
        turn: &str,
        request: &ToolResultRequest,
        on: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        self.results.lock().unwrap().push(request.output.clone());
        on(event(
            json!({ "type": "text.delta", "turnId": turn, "text": "Noted." }),
        ));
        on(event(
            json!({ "type": "turn.completed", "turnId": turn, "stopReason": "end_turn" }),
        ));
        Ok(())
    }
}

fn scripted(echo: &Echo) -> Arc<Scripted> {
    Arc::new(Scripted {
        inner: HttpBrain::new(echo.url()).unwrap(),
        contexts: Mutex::default(),
        results: Mutex::default(),
    })
}

/// A shared core on `brain` keeping memory under `home`, the person saying yes to every prompt.
fn core_on(brain: Arc<Scripted>, home: &Path) -> (Arc<Core>, Receiver<Delivery>) {
    let options = BrainOptions {
        retry: Duration::from_millis(50),
        ..BrainOptions::default()
    };
    let core = Core::new(roots(home))
        .with_prompter(SayYes)
        .with_memory_dir(home.join("data/memory"))
        .with_brain(brain, options);
    let core = Arc::new(core);
    core.route_tools();
    for scope in [
        json!({ "permission": "brain:converse" }),
        json!({ "permission": "memory:read" }),
        json!({ "permission": "memory:write" }),
        manage(),
    ] {
        grant(&core, "desk", scope);
    }
    let deliveries = core.events().subscribe_addressed();
    (core, deliveries)
}

fn say(core: &Core, text: &str) -> String {
    let params = json!({ "text": text, "scope": { "permission": "brain:converse" } });
    call(core, "desk", "brain.say", params).unwrap()["turnId"]
        .as_str()
        .unwrap()
        .to_owned()
}

/// Wait for the turn's completed (or error), answering approvals with `answer`; the approvals seen.
fn finish(core: &Core, deliveries: &Receiver<Delivery>, turn: &str, answer: &str) -> Vec<Value> {
    let mut approvals = Vec::new();
    loop {
        let delivery = deliveries
            .recv_timeout(Duration::from_secs(10))
            .expect("an event within 10 s");
        let seen = serde_json::to_value(&delivery.event).unwrap();
        if seen["event"] == "perm.prompt" {
            // Eris's first use of memory:write asks the person (ADR 0072): yes, for the session.
            answer_prompt(core, &seen["data"], "session");
            continue;
        }
        if seen["event"] == "perm.approval" {
            approvals.push(seen["data"].clone());
            let params = json!({ "approvalId": seen["data"]["approvalId"], "answer": answer, "scope": manage() });
            call(core, "desk", "perm.approve", params).unwrap();
            continue;
        }
        if seen["event"] == "brain.turn" && seen["data"]["turnId"] == turn {
            let kind = seen["data"]["kind"].as_str().unwrap_or_default().to_owned();
            if kind == "completed" || kind == "error" {
                return approvals;
            }
        }
    }
}

/// perm.answer as `desk`: granted for `duration`.
fn answer_prompt(core: &Core, prompt: &Value, duration: &str) {
    let params = json!({ "promptId": prompt["promptId"], "granted": true, "duration": duration,
        "scope": manage() });
    call(core, "desk", "perm.answer", params).unwrap();
}

fn facts(core: &Core) -> Value {
    let params = json!({ "kind": "fact", "scope": { "permission": "memory:read" } });
    call(core, "desk", "memory.list", params).unwrap()["entries"].clone()
}

#[test]
fn eris_asks_before_she_remembers_a_fact() {
    let echo = Echo::start();
    let home = home("eris-remember");
    let brain = scripted(&echo);
    let (core, deliveries) = core_on(brain.clone(), &home);

    let turn = say(&core, "remember that I prefer pnpm over npm");
    let approvals = finish(&core, &deliveries, &turn, "once");
    assert_eq!(approvals.len(), 1);
    assert_eq!(approvals[0]["caller"], "agent:eris");
    assert_eq!(approvals[0]["action"], "memory.remember");
    assert_eq!(approvals[0]["target"], "I prefer pnpm over npm");
    assert_eq!(
        approvals[0]["preview"],
        json!({ "kind": "fact", "text": "I prefer pnpm over npm" })
    );
    let kept = facts(&core);
    assert_eq!(kept.as_array().unwrap().len(), 1);
    assert_eq!(kept[0]["text"], "I prefer pnpm over npm");
    assert_eq!(kept[0]["by"], "eris");

    let turn = say(&core, "remember that my bank PIN is 1234");
    finish(&core, &deliveries, &turn, "deny");
    assert_eq!(
        facts(&core).as_array().unwrap().len(),
        1,
        "a denied fact is not kept"
    );
    let results = brain.results.lock().unwrap();
    assert_eq!(
        results.last().unwrap()["reason"],
        "not-approved",
        "{results:?}"
    );
}

#[test]
fn an_always_grant_lets_eris_remember_freely() {
    let echo = Echo::start();
    let home = home("eris-remember-freely");
    let (core, deliveries) = core_on(scripted(&echo), &home);
    // The person lets Eris remember freely: an always grant of memory:write.
    let always = json!({ "permission": { "permission": "memory:write" }, "reason": "remember freely",
        "duration": "always" });
    std::thread::scope(|s| {
        let asking = s.spawn(|| call(&core, "agent:eris", "perm.request", always).unwrap());
        answer_prompt(&core, wait_for(&deliveries, "perm.prompt").data(), "always");
        assert_eq!(asking.join().unwrap()["granted"], true);
    });

    let turn = say(&core, "remember that standup is at ten");
    let approvals = finish(&core, &deliveries, &turn, "deny");
    assert!(approvals.is_empty(), "{approvals:?}");
    assert_eq!(facts(&core)[0]["text"], "standup is at ten");
}

#[test]
fn an_episode_is_kept_after_each_turn() {
    let echo = Echo::start();
    let home = home("eris-episode");
    let (core, deliveries) = core_on(scripted(&echo), &home);
    let turn = say(&core, "what is on today?");
    finish(&core, &deliveries, &turn, "once");
    let params = json!({ "kind": "episode", "scope": { "permission": "memory:read" } });
    let episodes = call(&core, "desk", "memory.list", params).unwrap()["entries"].clone();
    assert_eq!(episodes.as_array().unwrap().len(), 1);
    assert_eq!(episodes[0]["asked"], "what is on today?");
    assert_eq!(episodes[0]["answered"], "echo: what is on today?");
    assert_eq!(episodes[0]["by"], "eris");
}

#[test]
fn a_turn_carries_recalled_facts_recent_episodes_and_working_context() {
    let echo = Echo::start();
    let home = home("eris-context");
    let brain = scripted(&echo);
    let (core, deliveries) = core_on(brain.clone(), &home);
    let remember =
        json!({ "text": "Prefers pnpm over npm", "scope": { "permission": "memory:write" } });
    call(&core, "desk", "memory.remember", remember).unwrap();
    let first = say(&core, "hello there");
    finish(&core, &deliveries, &first, "once");

    let turn = say(&core, "which package manager do I use?");
    finish(&core, &deliveries, &turn, "once");
    let contexts = brain.contexts.lock().unwrap();
    let context = serde_json::to_value(contexts.last().unwrap().as_ref().unwrap()).unwrap();
    assert_eq!(context["facts"][0]["text"], "Prefers pnpm over npm");
    assert_eq!(context["episodes"][0]["asked"], "hello there");
    assert_eq!(context["episodes"][0]["answered"], "echo: hello there");
    assert!(
        context["working"]["now"]
            .as_str()
            .unwrap()
            .starts_with("20"),
        "{context}"
    );
}

#[test]
fn a_restarted_desk_still_knows_yesterdays_facts() {
    let echo = Echo::start();
    let home = home("eris-restart");
    {
        let (core, _deliveries) = core_on(scripted(&echo), &home);
        let remember = json!({ "text": "Works on Desk this month", "scope": { "permission": "memory:write" } });
        call(&core, "desk", "memory.remember", remember).unwrap();
    }
    let brain = scripted(&echo);
    let (core, deliveries) = core_on(brain.clone(), &home);
    let turn = say(&core, "what am I working on?");
    finish(&core, &deliveries, &turn, "once");
    let contexts = brain.contexts.lock().unwrap();
    let context = serde_json::to_value(contexts[0].as_ref().unwrap()).unwrap();
    assert_eq!(context["facts"][0]["text"], "Works on Desk this month");
}
