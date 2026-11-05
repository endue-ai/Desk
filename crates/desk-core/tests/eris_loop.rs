//! Eris's agentic loop (ADR 0084): every brain.say turn offers the commands plugins mark as tools,
//! the core runs the brain's call of one as `agent:eris` through cmd.invoke, the command's answer
//! goes back to the brain, and the turn shows each hand-off as `tool` and `tool-result` steps. The
//! brain here is examples/brain-echo for sessions and leases, with scripted turns.

mod common;
mod support;

use std::fs;
use std::path::Path;
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::Echo;
use desk_brain::{
    Brain, BrainFailure, CreateSessionRequest, Lease, LeaseAcquireRequest, LeaseRenewRequest,
    Session, StopReason, TextDeltaEvent, ToolCall, ToolCallEvent, ToolDefinition,
    ToolResultRequest, TurnCompletedEvent, TurnEvent, TurnRequest, TurnStartedEvent,
};
use desk_brain_endue::HttpBrain;
use desk_core::{BrainOptions, Core, Delivery, MAX_STEPS, TOO_MANY_LINE};
use serde_json::{Value, json};
use support::*;

const MAIL: &str = "example.mail";
const LATEST: &str = "example.mail.latest";

/// brain-echo, except that a turn offering tools calls `example_mail_latest` (forever, when
/// `endless`) and then says what the tool answered. It keeps the tools each turn offered.
struct Errands {
    inner: HttpBrain,
    endless: bool,
    offered: Mutex<Vec<Vec<ToolDefinition>>>,
    results: Mutex<Vec<Value>>,
}

macro_rules! pass {
    ($($name:ident($($arg:ident: $ty:ty),*) -> $out:ty;)*) => {$(
        fn $name(&self, $($arg: $ty),*) -> Result<$out, BrainFailure> {
            self.inner.$name($($arg),*)
        }
    )*};
}

fn event(turn: &str, kind: &str, extra: Value) -> TurnEvent {
    let mut value = json!({ "type": kind, "turnId": turn });
    value
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    serde_json::from_value(value).unwrap()
}

fn ask_latest(turn: &str, n: usize, on: &mut dyn FnMut(TurnEvent)) {
    let call = ToolCall {
        call_id: format!("call{n}"),
        name: "example_mail_latest".to_owned(),
        arguments: json!({ "limit": 3 }).as_object().cloned().unwrap(),
        agent_id: None,
    };
    on(TurnEvent::ToolCall(ToolCallEvent {
        r#type: Default::default(),
        turn_id: turn.to_owned(),
        call,
    }));
    on(TurnEvent::TurnCompleted(TurnCompletedEvent {
        r#type: Default::default(),
        turn_id: turn.to_owned(),
        stop_reason: StopReason::ToolCall,
    }));
}

impl Brain for Errands {
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
        _session: &str,
        request: &TurnRequest,
        on: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        let tools = request.tools.clone().unwrap_or_default();
        self.offered.lock().unwrap().push(tools);
        on(TurnEvent::TurnStarted(TurnStartedEvent {
            r#type: Default::default(),
            turn_id: "turn1".to_owned(),
        }));
        ask_latest("turn1", 1, on);
        Ok(())
    }
    fn submit_tool_result(
        &self,
        _session: &str,
        turn: &str,
        request: &ToolResultRequest,
        on: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        let mut results = self.results.lock().unwrap();
        results.push(request.output.clone());
        if self.endless {
            ask_latest(turn, results.len() + 1, on);
            return Ok(());
        }
        let said = format!("You have mail: {}", request.output);
        let text = TurnEvent::TextDelta(TextDeltaEvent {
            r#type: Default::default(),
            turn_id: turn.to_owned(),
            text: said,
        });
        on(text);
        on(event(
            turn,
            "turn.completed",
            json!({ "stopReason": "end_turn" }),
        ));
        Ok(())
    }
}

/// A shared core on `brain`, with example.mail installed and its two commands registered: one a
/// tool for Eris, one not. The person says yes to every prompt.
fn core_on(brain: Arc<dyn Brain>, home: &Path) -> (Arc<Core>, Receiver<Delivery>) {
    let dir = home.join("plugins/mail");
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>mail</p>").unwrap();
    let manifest = json!({
        "id": MAIL, "version": "0.1.0", "kind": "ui", "entry": "ui/index.html",
        "contributes": { "commands": [
            { "id": LATEST, "title": "Latest mail", "tool": {
                "description": "The newest messages in the inbox.",
                "args": { "type": "object", "properties": { "limit": { "type": "integer" } } } } },
            { "id": "example.mail.compose", "title": "New message" },
        ] },
    });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    let options = BrainOptions {
        retry: Duration::from_millis(50),
        ..BrainOptions::default()
    };
    let core = Core::new(roots(home))
        .with_prompter(SayYes)
        .with_brain(brain, options);
    core.install_plugin(&dir, false);
    let core = Arc::new(core);
    core.route_tools();
    grant(&core, "desk", json!({ "permission": "brain:converse" }));
    for (id, title) in [
        (LATEST, "Latest mail"),
        ("example.mail.compose", "New message"),
    ] {
        call(
            &core,
            MAIL,
            "cmd.register",
            json!({ "id": id, "title": title }),
        )
        .unwrap();
    }
    let deliveries = core.events().subscribe_addressed();
    (core, deliveries)
}

fn errands(echo: &Echo, endless: bool) -> Arc<Errands> {
    Arc::new(Errands {
        inner: HttpBrain::new(echo.url()).unwrap(),
        endless,
        offered: Mutex::default(),
        results: Mutex::default(),
    })
}

fn say(core: &Core, text: &str) -> String {
    let params = json!({ "text": text, "scope": { "permission": "brain:converse" } });
    let said = call(core, "desk", "brain.say", params).unwrap();
    said["turnId"].as_str().unwrap().to_owned()
}

/// The turn's brain.turn data up to its completed or error, answering every cmd.invoked of the
/// mail plugin with two messages.
fn play(core: &Core, deliveries: &Receiver<Delivery>, turn: &str) -> Vec<Value> {
    let mut steps = Vec::new();
    loop {
        let delivery = deliveries
            .recv_timeout(Duration::from_secs(10))
            .expect("a delivery within 10 s");
        let seen = serde_json::to_value(&delivery.event).unwrap();
        let data = seen["data"].clone();
        if seen["event"] == "cmd.invoked" {
            assert_eq!(data["caller"], "agent:eris");
            let answered = json!({ "invocationId": data["invocationId"],
                "result": { "messages": [{ "subject": "Lunch?" }, { "subject": "Invoice" }] } });
            call(core, MAIL, "cmd.answer", answered).unwrap();
            continue;
        }
        if seen["event"] != "brain.turn" || data["turnId"] != turn {
            continue;
        }
        let kind = data["kind"].as_str().unwrap().to_owned();
        steps.push(data);
        if kind == "completed" || kind == "error" {
            return steps;
        }
    }
}

#[test]
fn a_turn_offers_the_commands_plugins_mark_as_tools() {
    let echo = Echo::start();
    let home = home("eris-offer");
    let brain = errands(&echo, false);
    let (core, deliveries) = core_on(brain.clone(), &home);
    let turn = say(&core, "Check my latest mail");
    play(&core, &deliveries, &turn);
    let offered = brain.offered.lock().unwrap().remove(0);
    let names: Vec<&str> = offered.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(names, ["example_mail_latest"]);
    assert!(
        offered[0]
            .description
            .contains("The newest messages in the inbox.")
    );
    assert!(offered[0].description.contains("Latest mail"));
    assert_eq!(offered[0].schema["properties"]["limit"]["type"], "integer");
}

#[test]
fn eris_goes_to_the_plugin_and_comes_back_with_its_answer() {
    let echo = Echo::start();
    let home = home("eris-errand");
    let brain = errands(&echo, false);
    let (core, deliveries) = core_on(brain.clone(), &home);
    let turn = say(&core, "Check my latest mail");
    let steps = play(&core, &deliveries, &turn);
    let kinds: Vec<&str> = steps.iter().map(|s| s["kind"].as_str().unwrap()).collect();
    assert_eq!(
        kinds,
        ["started", "tool", "tool-result", "delta", "completed"]
    );
    let tool = json!({ "callId": "call1", "command": LATEST, "provider": MAIL,
        "title": "Latest mail" });
    assert_eq!(steps[1]["tool"], tool);
    let mut back = tool.clone();
    back["ok"] = json!(true);
    assert_eq!(steps[2]["tool"], back);
    assert!(steps[3]["text"].as_str().unwrap().contains("Lunch?"));
    let results = brain.results.lock().unwrap();
    assert_eq!(results[0]["messages"][1]["subject"], "Invoice");
}

#[test]
fn a_turn_that_keeps_calling_tools_ends_after_max_steps() {
    let echo = Echo::start();
    let home = home("eris-endless");
    let brain = errands(&echo, true);
    let (core, deliveries) = core_on(brain.clone(), &home);
    let turn = say(&core, "Check my latest mail");
    let steps = play(&core, &deliveries, &turn);
    let last = steps.last().unwrap();
    assert_eq!(last["kind"], "error");
    assert_eq!(last["text"], TOO_MANY_LINE);
    assert_eq!(brain.results.lock().unwrap().len(), MAX_STEPS);
}

#[test]
fn brain_echo_calls_the_tool_the_message_names_and_says_its_answer() {
    let echo = Echo::start();
    let home = home("eris-echo");
    let brain = Arc::new(HttpBrain::new(echo.url()).unwrap());
    let (core, deliveries) = core_on(brain, &home);
    let turn = say(&core, "Check my latest mail");
    let steps = play(&core, &deliveries, &turn);
    let kinds: Vec<&str> = steps.iter().map(|s| s["kind"].as_str().unwrap()).collect();
    let tool = kinds
        .iter()
        .position(|k| *k == "tool")
        .expect("a tool step");
    assert_eq!(kinds[tool + 1], "tool-result");
    assert_eq!(steps[tool]["tool"]["command"], LATEST);
    let said: String = steps.iter().filter_map(|s| s["text"].as_str()).collect();
    assert!(
        said.contains("The example_mail_latest tool said:"),
        "{said}"
    );
    assert!(said.contains("Lunch?"), "{said}");
}

/// brain-echo for sessions and leases, refusing every turn as endue AI refuses a desk without a
/// good endue ID token.
struct WantsToken(HttpBrain);

impl Brain for WantsToken {
    fn create_session(&self, request: &CreateSessionRequest) -> Result<Session, BrainFailure> {
        self.0.create_session(request)
    }
    fn get_session(&self, session: &str) -> Result<Session, BrainFailure> {
        self.0.get_session(session)
    }
    fn get_lease(&self, session: &str) -> Result<Lease, BrainFailure> {
        self.0.get_lease(session)
    }
    fn acquire_lease(&self, s: &str, r: &LeaseAcquireRequest) -> Result<Lease, BrainFailure> {
        self.0.acquire_lease(s, r)
    }
    fn renew_lease(&self, s: &str, l: &str, r: &LeaseRenewRequest) -> Result<Lease, BrainFailure> {
        self.0.renew_lease(s, l, r)
    }
    fn release_lease(&self, session: &str, lease: &str) -> Result<(), BrainFailure> {
        self.0.release_lease(session, lease)
    }
    fn create_turn(
        &self,
        _session: &str,
        _request: &TurnRequest,
        _on: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        let error = json!({ "code": "unauthorized", "message": "Sign in with endue ID." });
        Err(BrainFailure::Refused {
            status: 401,
            error: serde_json::from_value(error).unwrap(),
        })
    }
    fn submit_tool_result(
        &self,
        session: &str,
        turn: &str,
        request: &ToolResultRequest,
        on: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        self.0.submit_tool_result(session, turn, request, on)
    }
}

#[test]
fn a_brain_that_wants_an_endue_id_token_has_eris_ask_the_person_to_sign_in() {
    let echo = Echo::start();
    let home = home("eris-sign-in");
    let brain = Arc::new(WantsToken(HttpBrain::new(echo.url()).unwrap()));
    let (core, deliveries) = core_on(brain, &home);
    let turn = say(&core, "Check my latest mail");
    let steps = play(&core, &deliveries, &turn);
    let last = steps.last().unwrap();
    assert_eq!(last["kind"], "error");
    assert_eq!(last["text"], desk_core::SIGN_IN_LINE);
}
