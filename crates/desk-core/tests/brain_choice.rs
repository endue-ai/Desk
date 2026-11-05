//! The desk chooses Eris's brain (ADR 0094): the runtime's setting `brain.use` (endue, local or
//! echo) picks the brain of every turn, init.yaml can set it and the local model, and a remote brain
//! that cannot be reached hands the turn to the local brain, which Eris says once. The remote brains
//! here are examples/brain-echo with a name in their answers; the local one is desk-brain-local's
//! `LocalBrain` on a fake Ollama (std's TcpListener, no network).

mod common;
mod ollama;
mod support;

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use common::{Echo, free_port};
use desk_brain::{
    Brain, BrainFailure, CreateSessionRequest, Lease, LeaseAcquireRequest, LeaseRenewRequest,
    Session, TextDeltaEvent, ToolResultRequest, TurnEvent, TurnRequest, TurnStartedEvent,
};
use desk_brain_endue::HttpBrain;
use desk_brain_local::{LocalBrain, LocalBrainOptions};
use desk_core::{BrainOptions, Brains, Core, DEFAULT_LOCAL_MODEL, Delivery, FALLBACK_LINE};
use ollama::FakeOllama;
use serde_json::{Value, json};
use support::*;

/// brain-echo for sessions and leases, answering every turn with `<name>: <text>`; it counts turns.
struct Named {
    name: &'static str,
    inner: HttpBrain,
    turns: AtomicUsize,
}

macro_rules! pass {
    ($($name:ident($($arg:ident: $ty:ty),*) -> $out:ty;)*) => {$(
        fn $name(&self, $($arg: $ty),*) -> Result<$out, BrainFailure> {
            self.inner.$name($($arg),*)
        }
    )*};
}

impl Brain for Named {
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
        self.turns.fetch_add(1, Ordering::SeqCst);
        let text = request.message.content[0].text.clone();
        on(TurnEvent::TurnStarted(TurnStartedEvent {
            r#type: Default::default(),
            turn_id: "turn1".to_owned(),
        }));
        on(TurnEvent::TextDelta(TextDeltaEvent {
            r#type: Default::default(),
            turn_id: "turn1".to_owned(),
            text: format!("{}: {text}", self.name),
        }));
        let done = json!({ "type": "turn.completed", "turnId": "turn1", "stopReason": "end_turn" });
        on(serde_json::from_value(done).unwrap());
        Ok(())
    }
    fn submit_tool_result(
        &self,
        _: &str,
        _: &str,
        _: &ToolResultRequest,
        _: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        unreachable!("these turns call no tools")
    }
    fn list_spaces(&self) -> Result<desk_brain::SpaceList, BrainFailure> {
        self.inner.list_spaces()
    }
}

fn named(name: &'static str, url: &str) -> Arc<Named> {
    Arc::new(Named {
        name,
        inner: HttpBrain::new(url).unwrap(),
        turns: AtomicUsize::new(0),
    })
}

/// A remote brain nothing answers at.
fn closed() -> Arc<dyn Brain> {
    Arc::new(HttpBrain::new(&format!("http://127.0.0.1:{}/v0", free_port())).unwrap())
}

/// Local brains as the app makes them: `LocalBrain` on `ollama` in `folder`, one per model. Each
/// model asked for is kept in `models`.
fn local_on(ollama: &str, folder: &Path, models: Arc<Mutex<Vec<String>>>) -> Brains {
    let (ollama, folder) = (ollama.to_owned(), folder.to_path_buf());
    Brains::default().with_local(move |model: &str| {
        models.lock().unwrap().push(model.to_owned());
        let options = LocalBrainOptions::new(model).with_base_url(ollama.clone());
        let brain = LocalBrain::open(folder.join(model), options)?;
        Ok(Arc::new(brain) as Arc<dyn Brain>)
    })
}

/// A shared core on `brains`, reading `home/.desk/init.yaml` as the app does.
fn core_on(brains: Brains, home: &Path) -> (Arc<Core>, Receiver<Delivery>) {
    let options = BrainOptions {
        retry: Duration::from_millis(50),
        ..BrainOptions::default()
    };
    let core = Core::new(roots(home))
        .with_init_file(home.join(".desk/init.yaml"))
        .with_brains(brains.with_options(options));
    let core = Arc::new(core);
    core.route_tools();
    grant(&core, "desk", json!({ "permission": "brain:converse" }));
    let deliveries = core.events().subscribe_addressed();
    (core, deliveries)
}

fn choose(core: &Core, brain: &str) {
    let params = json!({ "key": "brain.use", "value": brain });
    call(core, "desk", "settings.set", params).unwrap();
}

fn status(core: &Core) -> Value {
    let params = json!({ "scope": { "permission": "brain:converse" } });
    call(core, "desk", "brain.status", params).unwrap()
}

/// Say `text` and gather the turn's kinds and its answer, up to its completed, error or offline.
fn turn(core: &Core, deliveries: &Receiver<Delivery>, text: &str) -> (Vec<String>, String) {
    let params = json!({ "text": text, "scope": { "permission": "brain:converse" } });
    let said = call(core, "desk", "brain.say", params).unwrap();
    let id = said["turnId"].clone();
    let (mut kinds, mut answer) = (Vec::new(), String::new());
    loop {
        let delivery = deliveries
            .recv_timeout(Duration::from_secs(10))
            .expect("a brain.turn within 10 s");
        let seen = serde_json::to_value(&delivery.event).unwrap();
        if seen["event"] != "brain.turn" || seen["data"]["turnId"] != id {
            continue;
        }
        let kind = seen["data"]["kind"].as_str().unwrap().to_owned();
        match kind.as_str() {
            "started" => answer.clear(),
            "delta" => answer.push_str(seen["data"]["text"].as_str().unwrap()),
            _ => {}
        }
        kinds.push(kind.clone());
        if ["completed", "error", "offline"].contains(&kind.as_str()) {
            return (kinds, answer);
        }
    }
}

#[test]
fn the_setting_chooses_the_brain_for_each_turn() {
    let echo = Echo::start();
    let home = home("brain-choice");
    let (endue, remote_echo, local) = (
        named("endue", echo.url()),
        named("echo", echo.url()),
        named("local", echo.url()),
    );
    let local_brain = Arc::clone(&local);
    let brains = Brains::default()
        .with_endue(endue.clone())
        .with_echo(remote_echo.clone())
        .with_local(move |_model: &str| Ok(local_brain.clone() as Arc<dyn Brain>));
    let (core, deliveries) = core_on(brains, &home);

    // Nothing set: endue AI.
    assert_eq!(status(&core), json!({ "mode": "cloud", "brain": "endue" }));
    assert_eq!(turn(&core, &deliveries, "hi").1, "endue: hi");

    choose(&core, "echo");
    assert_eq!(status(&core), json!({ "mode": "cloud", "brain": "echo" }));
    assert_eq!(turn(&core, &deliveries, "hi").1, "echo: hi");

    choose(&core, "local");
    let local_status = json!({ "mode": "local", "model": DEFAULT_LOCAL_MODEL, "brain": "local" });
    assert_eq!(status(&core), local_status);
    assert_eq!(turn(&core, &deliveries, "hi").1, "local: hi");

    // A value outside the three leaves the default in force.
    choose(&core, "gpt");
    assert_eq!(turn(&core, &deliveries, "again").1, "endue: again");
    assert_eq!(endue.turns.load(Ordering::SeqCst), 2);
    assert_eq!(remote_echo.turns.load(Ordering::SeqCst), 1);
    assert_eq!(local.turns.load(Ordering::SeqCst), 1);
}

#[test]
fn init_yaml_chooses_the_brain_and_the_local_model_at_start() {
    let ollama = FakeOllama::start();
    let home = home("brain-choice-init");
    fs::create_dir_all(home.join(".desk")).unwrap();
    let init = "version: 0\nsettings:\n  desk.brain.use: local\n  desk.brain.model: qwen2.5\n";
    fs::write(home.join(".desk/init.yaml"), init).unwrap();
    let models = Arc::new(Mutex::new(Vec::new()));
    let brains = local_on(&ollama.url, &home.join("local"), models.clone()).with_endue(closed());
    let (core, deliveries) = core_on(brains, &home);

    let expected = json!({ "mode": "local", "model": "qwen2.5", "brain": "local" });
    assert_eq!(status(&core), expected);
    let (_, answer) = turn(&core, &deliveries, "hi");
    assert_eq!(answer, "Hi from qwen2.5");
    assert!(models.lock().unwrap().iter().all(|m| m == "qwen2.5"));
}

#[test]
fn an_unreachable_remote_brain_falls_back_to_the_local_brain_and_eris_says_so_once() {
    let ollama = FakeOllama::start();
    let home = home("brain-choice-fallback");
    let models = Arc::new(Mutex::new(Vec::new()));
    let brains = local_on(&ollama.url, &home.join("local"), models).with_endue(closed());
    let (core, deliveries) = core_on(brains, &home);

    let (kinds, first) = turn(&core, &deliveries, "hi");
    assert!(!kinds.contains(&"offline".to_owned()), "{kinds:?}");
    assert!(first.starts_with(FALLBACK_LINE), "{first:?}");
    assert!(
        first.ends_with(&format!("Hi from {DEFAULT_LOCAL_MODEL}")),
        "{first:?}"
    );

    let (_, second) = turn(&core, &deliveries, "and now?");
    assert_eq!(second, format!("Hi from {DEFAULT_LOCAL_MODEL}"));

    let expected = json!({ "mode": "local", "model": DEFAULT_LOCAL_MODEL, "brain": "endue",
        "fallback": true });
    assert_eq!(status(&core), expected);
}

#[test]
fn a_local_choice_never_falls_back_to_a_remote_brain() {
    let echo = Echo::start();
    let home = home("brain-choice-local-only");
    let endue = named("endue", echo.url());
    let ollama = format!("http://127.0.0.1:{}", free_port());
    let models = Arc::new(Mutex::new(Vec::new()));
    let brains = local_on(&ollama, &home.join("local"), models).with_endue(endue.clone());
    let (core, deliveries) = core_on(brains, &home);
    choose(&core, "local");

    let (kinds, _) = turn(&core, &deliveries, "hi");
    assert_eq!(kinds.last().map(String::as_str), Some("offline"));
    assert_eq!(
        status(&core),
        json!({ "mode": "offline", "brain": "local" })
    );
    assert_eq!(endue.turns.load(Ordering::SeqCst), 0);
}

#[test]
fn a_desk_without_a_local_brain_stays_offline_when_the_remote_is_down() {
    let home = home("brain-choice-no-local");
    let (core, deliveries) = core_on(Brains::default().with_endue(closed()), &home);

    let (kinds, _) = turn(&core, &deliveries, "hi");
    assert_eq!(kinds.last().map(String::as_str), Some("offline"));
    assert_eq!(
        status(&core),
        json!({ "mode": "offline", "brain": "endue" })
    );
}
