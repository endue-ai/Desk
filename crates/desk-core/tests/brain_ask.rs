//! brain.ask against examples/brain-echo (ADR 0059): an ask opens a session of its own with its own
//! lease, offers the caller's tool with toolChoice naming it, hands the tool call's arguments back as
//! `structured` to the caller only, never runs the tool and releases the lease. It needs brain:ask,
//! which brain:converse does not stand in for, and an unreachable brain gives brain.say's offline
//! turn. brain-echo's propose_theme answers pass specs/plugin/v0/theme.schema.json.

mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use common::{Echo, free_port};
use desk_brain::{
    Brain, BrainErrorCode, BrainFailure, CreateSessionRequest, Lease, LeaseAcquireRequest,
    LeaseRenewRequest, NamedToolChoice, Session, ToolChoice, ToolDefinition, ToolResultRequest,
    TurnEvent, TurnRequest,
};
use desk_brain_endue::HttpBrain;
use desk_bridge::{
    BrainTurnData, BrainTurnKind, BridgeEvent, BridgeRequest, BridgeResponse, ErrorCode,
    Permission, SCHEMAS,
};
use desk_core::{BrainOptions, Core, Delivery, OFFLINE_LINE, Roots};
use serde_json::{Value, json};

/// The runtime: it holds brain:ask, and brain:converse for the desk's conversation.
const DESK: &str = "desk";
const ERIS: &str = "endue.eris";
const STUDIO: &str = "endue.studio";
const THEME: &str = "https://endue.ai/specs/plugin/v0/theme.schema.json#/$defs/ThemePackage";

/// brain-echo, with every call the core makes written down.
struct Recorder {
    inner: HttpBrain,
    turns: Mutex<Vec<(String, TurnRequest)>>,
    results: AtomicUsize,
    released: Mutex<Vec<(String, String, bool)>>,
}

impl Recorder {
    fn new(url: &str) -> Arc<Self> {
        Arc::new(Self {
            inner: HttpBrain::new(url).unwrap(),
            turns: Mutex::default(),
            results: AtomicUsize::new(0),
            released: Mutex::default(),
        })
    }
}

/// Brain methods the recorder hands straight to brain-echo.
macro_rules! pass {
    ($($name:ident($($arg:ident: $ty:ty),*) -> $out:ty;)*) => {$(
        fn $name(&self, $($arg: $ty),*) -> Result<$out, BrainFailure> {
            self.inner.$name($($arg),*)
        }
    )*};
}

impl Brain for Recorder {
    pass! {
        create_session(request: &CreateSessionRequest) -> Session;
        get_session(session: &str) -> Session;
        get_lease(session: &str) -> Lease;
        acquire_lease(session: &str, request: &LeaseAcquireRequest) -> Lease;
        renew_lease(session: &str, lease: &str, request: &LeaseRenewRequest) -> Lease;
    }
    fn create_turn(
        &self,
        session: &str,
        request: &TurnRequest,
        on: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        let turn = (session.to_owned(), request.clone());
        self.turns.lock().unwrap().push(turn);
        self.inner.create_turn(session, request, on)
    }
    fn submit_tool_result(
        &self,
        session: &str,
        turn: &str,
        request: &ToolResultRequest,
        on: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        self.results.fetch_add(1, Ordering::SeqCst);
        self.inner.submit_tool_result(session, turn, request, on)
    }
    fn release_lease(&self, session: &str, lease: &str) -> Result<(), BrainFailure> {
        let done = self.inner.release_lease(session, lease);
        let entry = (session.to_owned(), lease.to_owned(), done.is_ok());
        self.released.lock().unwrap().push(entry);
        done
    }
}

/// Who holds what: Eris talks but does not ask, the studio asks but does not talk.
const GRANTS: [(&str, &str); 4] = [
    (DESK, "brain:ask"),
    (DESK, "brain:converse"),
    (ERIS, "brain:converse"),
    (STUDIO, "brain:ask"),
];

/// A core on `brain` with leases that outlast any test (brain-echo's seconds are 20 ms here).
fn core(brain: Arc<dyn Brain>) -> Core {
    let options = BrainOptions {
        ttl_seconds: 3600,
        retry: Duration::from_millis(50),
        ..BrainOptions::default()
    };
    let core = Core::new(Roots {
        home: std::env::temp_dir(),
    })
    .with_brain(brain, options);
    for (caller, permission) in GRANTS {
        let permission = serde_json::from_value(json!({ "permission": permission }));
        core.grant(caller, permission.unwrap());
    }
    core
}

/// propose_theme as the theme studio offers it: a name, a sentence, and a theme block.
fn propose_theme() -> Value {
    json!({
        "name": "propose_theme",
        "description": "Propose a desk theme for what the person described.",
        "schema": {
            "type": "object",
            "properties": {
                "name": { "type": "string", "minLength": 1, "maxLength": 80 },
                "description": { "type": "string", "minLength": 1, "maxLength": 300 },
                "theme": { "$ref": THEME }
            },
            "required": ["name", "description", "theme"],
            "additionalProperties": false
        }
    })
}

type Refusal = (ErrorCode, Option<Permission>);

fn call(core: &Core, caller: &str, method: &str, params: Value) -> Result<Value, Refusal> {
    let request: BridgeRequest =
        serde_json::from_value(json!({ "id": 1, "method": method, "params": params })).unwrap();
    match core.handle(caller, request) {
        BridgeResponse::BridgeSuccess(ok) => Ok(ok.result),
        BridgeResponse::BridgeFailure(no) => Err((no.error.code, no.error.permission)),
    }
}

fn ask_params(prompt: &str, tool: Value) -> Value {
    json!({ "prompt": prompt, "tool": tool, "scope": { "permission": "brain:ask" } })
}

/// Ask with `tool` as `caller`; returns the turn id.
fn ask_with(core: &Core, caller: &str, prompt: &str, tool: Value) -> String {
    let params = ask_params(prompt, tool);
    let result = call(core, caller, "brain.ask", params).expect("brain.ask is answered");
    result["turnId"].as_str().unwrap().to_owned()
}

/// A turn's brain.turn events, each with the callers it was addressed to.
type Seen = Vec<(Option<Vec<String>>, BrainTurnData)>;

/// The deliveries of `turn` up to `last` (or an error).
fn until(deliveries: &Receiver<Delivery>, turn: &str, last: BrainTurnKind) -> Seen {
    let mut seen = Vec::new();
    loop {
        let delivery = deliveries
            .recv_timeout(Duration::from_secs(10))
            .unwrap_or_else(|_| panic!("no {last:?} for {turn}; saw {seen:?}"));
        if let BridgeEvent::BrainTurn(event) = delivery.event
            && event.data.turn_id == turn
        {
            let kind = event.data.kind;
            seen.push((delivery.to, event.data));
            if kind == last || kind == BrainTurnKind::Error {
                return seen;
            }
        }
    }
}

/// The structured answer to `prompt` through brain.ask and propose_theme.
fn proposed(core: &Core, prompt: &str) -> Value {
    let deliveries = core.events().subscribe_addressed();
    let turn = ask_with(core, DESK, prompt, propose_theme());
    let seen = until(&deliveries, &turn, BrainTurnKind::Completed);
    let (_, done) = seen.last().unwrap();
    assert_eq!(done.kind, BrainTurnKind::Completed, "{seen:?}");
    Value::Object(done.structured.clone().expect("the brain called the tool"))
}

fn theme_validator() -> &'static jsonschema::Validator {
    static VALIDATOR: OnceLock<jsonschema::Validator> = OnceLock::new();
    static REGISTRY: OnceLock<jsonschema::Registry<'static>> = OnceLock::new();
    let registry = REGISTRY.get_or_init(|| {
        let docs = SCHEMAS
            .iter()
            .map(|(id, text)| (id.to_string(), serde_json::from_str::<Value>(text).unwrap()));
        jsonschema::Registry::new()
            .extend(docs)
            .and_then(|builder| builder.prepare())
            .unwrap()
    });
    VALIDATOR.get_or_init(|| {
        jsonschema::options()
            .with_registry(registry)
            .should_validate_formats(false)
            .build(&json!({ "$ref": THEME }))
            .unwrap()
    })
}

/// A theme block that passes specs/plugin/v0/theme.schema.json, with a name and a description.
fn assert_theme(answer: &Value) -> &Value {
    let errors: Vec<String> = theme_validator()
        .iter_errors(&answer["theme"])
        .map(|e| format!("{}: {e}", e.instance_path()))
        .collect();
    assert!(errors.is_empty(), "{errors:?} in {answer}");
    for field in ["name", "description"] {
        let text = answer[field].as_str().unwrap_or_default();
        assert!(!text.is_empty(), "{field} in {answer}");
    }
    &answer["theme"]
}

#[test]
fn an_ask_answers_through_its_tool_in_a_session_of_its_own() {
    let echo = Echo::start();
    let recorder = Recorder::new(echo.url());
    let core = core(recorder.clone());
    let deliveries = core.events().subscribe_addressed();
    let turn = ask_with(&core, DESK, "따뜻한 종이 질감", propose_theme());
    let seen = until(&deliveries, &turn, BrainTurnKind::Completed);
    for (to, data) in &seen {
        assert_eq!(
            *to,
            Some(vec![DESK.to_owned()]),
            "for the caller only: {data:?}"
        );
    }
    assert_eq!(seen[0].1.kind, BrainTurnKind::Started);
    let (_, done) = seen.last().unwrap();
    assert_eq!(done.kind, BrainTurnKind::Completed);
    let structured = done.structured.as_ref().expect("the tool's arguments");
    assert_eq!(structured["name"], "Warm Paper");

    // One turn, in a session of its own, offering the tool and naming it.
    let turns = recorder.turns.lock().unwrap().clone();
    assert_eq!(turns.len(), 1, "{turns:?}");
    let (session, request) = &turns[0];
    let tool: ToolDefinition = serde_json::from_value(propose_theme()).unwrap();
    assert_eq!(request.tools, Some(vec![tool]));
    let named = NamedToolChoice {
        r#type: Default::default(),
        name: "propose_theme".to_owned(),
    };
    assert_eq!(request.tool_choice, Some(ToolChoice::NamedTool(named)));
    assert_eq!(
        core.brain_session(),
        None,
        "the desk's conversation has none yet"
    );

    // The tool never ran; the lease was given back before completed went out.
    assert_eq!(recorder.results.load(Ordering::SeqCst), 0);
    let released = recorder.released.lock().unwrap().clone();
    let lease = request.lease_id.clone();
    assert_eq!(released, vec![(session.clone(), lease, true)]);
    let lease = recorder.inner.get_lease(session).unwrap_err();
    assert_eq!(lease.code(), Some(BrainErrorCode::NotFound));

    // The desk's conversation goes on in a session the ask never touched.
    let params = json!({ "text": "hello", "scope": { "permission": "brain:converse" } });
    let said = call(&core, DESK, "brain.say", params).unwrap();
    let said = said["turnId"].as_str().unwrap();
    until(&deliveries, said, BrainTurnKind::Completed);
    let shared = core
        .brain_session()
        .expect("brain.say opened the desk's session");
    assert_ne!(&shared, session);
    let turns = recorder.turns.lock().unwrap().clone();
    assert_eq!(turns[1].0, shared);
    assert!(turns[1].1.tools.is_none() && turns[1].1.tool_choice.is_none());
}

#[test]
fn brain_ask_needs_brain_ask_and_brain_ask_reaches_no_conversation() {
    let echo = Echo::start();
    let core = core(Recorder::new(echo.url()));
    let ask = ask_params("warm", propose_theme());
    let (code, permission) = call(&core, ERIS, "brain.ask", ask).unwrap_err();
    assert_eq!(code, ErrorCode::PermissionDenied);
    assert!(matches!(permission, Some(Permission::BrainAsk(_))));

    let say = json!({ "text": "hello", "scope": { "permission": "brain:converse" } });
    let (code, permission) = call(&core, STUDIO, "brain.say", say).unwrap_err();
    assert_eq!(code, ErrorCode::PermissionDenied);
    assert!(matches!(permission, Some(Permission::BrainConverse(_))));
}

#[test]
fn the_tool_schema_must_compile_and_the_arguments_must_match_it() {
    let echo = Echo::start();
    let core = core(Recorder::new(echo.url()));
    for schema in [
        json!({ "type": "string" }),
        json!({ "type": "object", "minProperties": "two" }),
    ] {
        let tool = json!({ "name": "propose_theme", "description": "A theme.", "schema": schema });
        let (code, _) = call(&core, DESK, "brain.ask", ask_params("warm", tool)).unwrap_err();
        assert_eq!(code, ErrorCode::InvalidParams, "{schema}");
    }
    // brain-echo sends no palette: arguments that miss the schema are not handed over.
    let mut tool = propose_theme();
    tool["schema"]["required"] = json!(["name", "description", "theme", "palette"]);
    let deliveries = core.events().subscribe_addressed();
    let turn = ask_with(&core, DESK, "ocean glass", tool);
    let seen = until(&deliveries, &turn, BrainTurnKind::Completed);
    let (_, done) = seen.last().unwrap();
    assert_eq!(done.kind, BrainTurnKind::Completed);
    assert_eq!(done.structured, None);
}

#[test]
fn an_unreachable_brain_gives_the_offline_turn_and_the_ask_resumes() {
    let port = free_port();
    let brain = Arc::new(HttpBrain::new(&format!("http://127.0.0.1:{port}/v0")).unwrap());
    let core = core(brain);
    let deliveries = core.events().subscribe_addressed();
    let turn = ask_with(&core, DESK, "amber terminal at night", propose_theme());
    let offline = until(&deliveries, &turn, BrainTurnKind::Offline);
    let (to, data) = offline.last().unwrap();
    assert_eq!(data.text.as_deref(), Some(OFFLINE_LINE));
    assert_eq!(*to, Some(vec![DESK.to_owned()]));

    let _echo = Echo::start_on(port);
    let rest = until(&deliveries, &turn, BrainTurnKind::Completed);
    assert_eq!(rest[0].1.kind, BrainTurnKind::Online);
    let structured = rest.last().unwrap().1.structured.clone().unwrap();
    assert_eq!(structured["name"], "Amber Night Terminal");
}

#[test]
fn brain_echo_proposes_a_light_paper_theme_and_a_dark_amber_terminal() {
    let echo = Echo::start();
    let core = core(Recorder::new(echo.url()));

    let paper = proposed(&core, "따뜻한 종이 질감");
    let theme = assert_theme(&paper);
    assert!(theme["light"].is_object() && theme["dark"].is_null());
    assert_eq!(theme["tags"], json!(["warm", "paper", "grain"]));
    let shape = json!({ "radius": "soft", "density": "comfortable" });
    assert_eq!(theme["shape"], shape);
    assert_eq!(theme["motion"], json!({ "personality": "calm" }));
    assert!(theme["light"]["material"]["noise"].as_f64().unwrap() > 0.0);
    assert!(theme["type"]["sans"].as_str().unwrap().ends_with("serif"));
    assert_eq!(theme["origin"]["prompt"], "따뜻한 종이 질감");

    let amber = proposed(&core, "amber terminal at night");
    let theme = assert_theme(&amber);
    assert!(theme["dark"].is_object() && theme["light"].is_null());
    assert_eq!(theme["tags"], json!(["amber", "night", "terminal"]));
    assert_eq!(
        theme["shape"],
        json!({ "radius": "none", "density": "compact" })
    );
    assert_eq!(theme["motion"], json!({ "personality": "snappy" }));
    assert_eq!(theme["dark"]["colors"]["primary"], "#ffb000");
    let ansi = theme["dark"]["terminal"]["ansi"].as_array().unwrap();
    assert_eq!(ansi.len(), 16);
    assert_eq!(theme["type"]["mono"], theme["type"]["sans"]);
}

/// brain-echo's words, each with the tag it gives; "hello" is none of them.
const WORDS: &str = "warm:warm paper:paper amber:amber ocean:ocean forest:forest night:night \
    glass:glass pastel:pastel 따뜻한:warm 종이:paper 호박색:amber 바다:ocean 숲:forest 밤:night \
    유리:glass 파스텔:pastel 터미널:terminal hello:";

#[test]
fn brain_echo_knows_its_words_in_english_and_korean() {
    let echo = Echo::start();
    let core = core(Recorder::new(echo.url()));
    for pair in WORDS.split_whitespace() {
        let (word, tag) = pair.split_once(':').unwrap();
        let answer = proposed(&core, word);
        let tags = assert_theme(&answer)["tags"].as_array().cloned();
        let tags = tags.unwrap_or_default();
        let known = if tag.is_empty() {
            tags.is_empty() && answer["name"] == "Echo"
        } else {
            tags.contains(&json!(tag))
        };
        assert!(known, "{word}: {answer}");
    }
}
