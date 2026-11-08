//! Eris sees the desk (ADR 0109): a brain.say that carries the runtime's snapshot sends the brain
//! the desk in words before the line, each plugin on screen with its tools; a line without one
//! goes alone, as before. When the agent commands do not all fit in a turn, the commands of the
//! plugins on screen are offered by name first. ADR 0124: the words also name the other desktops'
//! windows, the windows closed recently and what the person can do, within a fixed size.

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
    Session, ToolResultRequest, TurnEvent, TurnRequest,
};
use desk_brain_endue::HttpBrain;
use desk_core::{BrainOptions, Core, Delivery};
use serde_json::{Value, json};
use support::*;

/// brain-echo, keeping every turn's request.
struct Recording {
    inner: HttpBrain,
    turns: Mutex<Vec<TurnRequest>>,
}

macro_rules! pass {
    ($($name:ident($($arg:ident: $ty:ty),*) -> $out:ty;)*) => {$(
        fn $name(&self, $($arg: $ty),*) -> Result<$out, BrainFailure> {
            self.inner.$name($($arg),*)
        }
    )*};
}

impl Brain for Recording {
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
        session: &str,
        request: &TurnRequest,
        on: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        self.turns.lock().unwrap().push(request.clone());
        self.inner.create_turn(session, request, on)
    }
    fn submit_tool_result(
        &self,
        session: &str,
        turn: &str,
        request: &ToolResultRequest,
        on: &mut dyn FnMut(TurnEvent),
    ) -> Result<(), BrainFailure> {
        self.inner.submit_tool_result(session, turn, request, on)
    }
}

fn core(echo: &Echo, home: &Path) -> (Arc<Core>, Arc<Recording>, Receiver<Delivery>) {
    let file = home.join("init.yaml");
    fs::write(&file, "").unwrap();
    let brain = Arc::new(Recording {
        inner: HttpBrain::new(echo.url()).unwrap(),
        turns: Mutex::new(Vec::new()),
    });
    let options = BrainOptions {
        retry: Duration::from_millis(50),
        ..BrainOptions::default()
    };
    let core = Core::new(roots(home))
        .with_prompter(NeverAsk)
        .with_init_file(file)
        .with_brain(brain.clone(), options);
    let core = Arc::new(core);
    core.route_tools();
    grant(&core, "desk", json!({ "permission": "brain:converse" }));
    let deliveries = core.events().subscribe_addressed();
    (core, brain, deliveries)
}

/// A plugin `id` with `count` read-only agent commands, `<id>.c0` on, all registered.
fn plugin(core: &Core, home: &Path, id: &str, count: usize) {
    let dir = home.join("plugins").join(id);
    fs::create_dir_all(dir.join("ui")).unwrap();
    fs::write(dir.join("ui/index.html"), "<p>plugin</p>").unwrap();
    let commands: Vec<Value> = (0..count)
        .map(|n| {
            json!({ "id": format!("{id}.c{n}"), "title": format!("C{n}"),
                "description": format!("Command {n}."), "agent": true, "readOnly": true })
        })
        .collect();
    let manifest = json!({ "id": id, "version": "0.1.0", "kind": "ui", "entry": "ui/index.html",
        "contributes": { "commands": commands } });
    fs::write(dir.join("plugin.json"), manifest.to_string()).unwrap();
    core.install_plugin(&dir, false);
    for n in 0..count {
        let registered = json!({ "id": format!("{id}.c{n}"), "title": format!("C{n}") });
        call(core, id, "cmd.register", registered).unwrap();
    }
}

/// The desk the runtime sees: `focused` in front, `other` floating behind it.
fn desk(focused: &str, other: &str) -> Value {
    let pane = |id: &str| json!({ "view": format!("plugin:{id}"), "plugin": id, "title": id });
    json!({
        "screen": { "w": 1440, "h": 900 },
        "windows": [
            { "id": "w1", "x": 760, "y": 40, "w": 640, "h": 800, "focused": true,
              "panes": [pane(focused)] },
            { "id": "w2", "x": 40, "y": 40, "w": 600, "h": 400, "floating": true,
              "panes": [pane(other)] }
        ]
    })
}

/// Say `text` (with `desk` when given) and wait for the turn to complete.
fn say(core: &Core, deliveries: &Receiver<Delivery>, text: &str, desk: Option<Value>) {
    let mut params = json!({ "text": text, "scope": { "permission": "brain:converse" } });
    if let Some(desk) = desk {
        params["desk"] = desk;
    }
    let said = call(core, "desk", "brain.say", params).unwrap();
    let turn = said["turnId"].as_str().unwrap().to_owned();
    loop {
        let delivery = deliveries
            .recv_timeout(Duration::from_secs(10))
            .expect("a delivery within 10 s");
        let event = serde_json::to_value(delivery.event).unwrap();
        let data = &event["data"];
        if event["event"] == "brain.turn" && data["turnId"] == turn.as_str() {
            match data["kind"].as_str() {
                Some("completed") => return,
                Some("error") => panic!("the turn failed: {data}"),
                _ => {}
            }
        }
    }
}

fn texts(request: &TurnRequest) -> Vec<String> {
    request
        .message
        .content
        .iter()
        .map(|p| p.text.clone())
        .collect()
}

fn names(request: &TurnRequest) -> Vec<String> {
    let tools = request.tools.as_deref().unwrap_or_default();
    tools.iter().map(|t| t.name.clone()).collect()
}

#[test]
fn a_line_with_the_desk_goes_after_the_desk_in_words_with_each_plugins_tools() {
    let echo = Echo::start();
    let home = home("desk-context-words");
    let (core, brain, deliveries) = core(&echo, &home);
    plugin(&core, &home, "example.git", 2);
    plugin(&core, &home, "example.notes", 1);
    say(
        &core,
        &deliveries,
        "what changed here?",
        Some(desk("example.git", "example.notes")),
    );
    say(&core, &deliveries, "and now?", None);

    let turns = brain.turns.lock().unwrap().clone();
    let with = texts(&turns[0]);
    assert_eq!(with.len(), 2, "the desk, then the line");
    assert_eq!(with[1], "what changed here?");
    let lines: Vec<&str> = with[0].lines().collect();
    assert!(lines[0].starts_with("[The desk as the person sees it"));
    assert_eq!(lines[1], "Screen 1440×900, 2 window(s), front to back:");
    assert_eq!(
        lines[2],
        "- w1: example.git (example.git) (focused), right, at 760,40 size 640×800"
    );
    assert_eq!(
        lines[3],
        "  example.git tools: example_git_c0, example_git_c1"
    );
    assert_eq!(
        lines[4],
        "- w2: example.notes (example.notes) (floating), top left, at 40,40 size 600×400"
    );
    assert_eq!(lines[5], "  example.notes tools: example_notes_c0");
    assert_eq!(lines[6], "[The person says:]");
    assert_eq!(
        texts(&turns[1]),
        ["and now?"],
        "a line without the desk goes alone"
    );
}

#[test]
fn past_a_turns_tools_the_plugins_on_screen_are_offered_by_name_first() {
    let echo = Echo::start();
    let home = home("desk-context-offer");
    let (core, brain, deliveries) = core(&echo, &home);
    plugin(&core, &home, "example.many", 28);
    plugin(&core, &home, "example.git", 2);
    plugin(&core, &home, "example.notes", 2);
    say(
        &core,
        &deliveries,
        "hello",
        Some(desk("example.git", "example.notes")),
    );
    say(&core, &deliveries, "hello", None);
    say(
        &core,
        &deliveries,
        "hello",
        Some(desk("example.many", "example.git")),
    );

    let turns = brain.turns.lock().unwrap().clone();
    assert_eq!(
        names(&turns[0]),
        [
            "desk-tools",
            "desk-run",
            "example_git_c0",
            "example_git_c1",
            "example_notes_c0",
            "example_notes_c1"
        ],
        "32 agent commands do not fit: those on screen do, the focused window's first"
    );
    assert_eq!(
        names(&turns[1]),
        ["desk-tools", "desk-run"],
        "no desk, no plugin first"
    );
    let crowded = names(&turns[2]);
    assert_eq!(crowded.len(), 32, "as many as fit");
    assert_eq!(crowded[2], "example_many_c0");
    assert_eq!(crowded[29], "example_many_c27");
    assert_eq!(&crowded[30..], ["example_git_c0", "example_git_c1"]);
}

fn pane(id: &str, title: &str) -> Value {
    json!({ "view": format!("plugin:{id}"), "plugin": id, "title": title })
}

/// The second of three desktops in front: Git on it, Mail in the drawer, Notes on the first
/// desktop; Terminal closed; and what the person can do.
fn views() -> Value {
    json!({
        "screen": { "w": 1440, "h": 900 },
        "windows": [
            { "id": "w1", "x": 760, "y": 40, "w": 640, "h": 800, "focused": true,
              "desktop": "2", "panes": [pane("example.git", "Git")] },
            { "id": "mail", "x": 200, "y": 120, "w": 560, "h": 400, "hidden": true,
              "panes": [pane("example.mail", "Mail")] },
            { "id": "w2", "x": 40, "y": 40, "w": 600, "h": 400, "desktop": "1",
              "panes": [pane("example.notes", "Notes")] }
        ],
        "desktops": [
            { "id": "1", "name": "Writing" },
            { "id": "2", "name": "Code", "current": true },
            { "id": "5", "name": "3" }
        ],
        "closed": [
            { "id": "term", "plugin": "example.terminal", "title": "Terminal", "x": 80, "y": 480,
              "w": 720, "h": 360, "desktop": "2", "closedAt": "2026-11-08T09:12:30.000Z" }
        ],
        "capabilities": {
            "commands": 142, "available": 118, "keyed": 40,
            "plugins": [
                { "id": "example.git", "title": "Git", "commands": 2, "available": 2,
                  "open": true, "views": ["plugin:example.git"] },
                { "id": "example.terminal", "title": "Terminal", "commands": 6, "available": 0 }
            ]
        }
    })
}

#[test]
fn the_words_name_the_other_desktops_the_closed_windows_and_what_the_person_can_do() {
    let echo = Echo::start();
    let home = home("desk-context-views");
    let (core, brain, deliveries) = core(&echo, &home);
    plugin(&core, &home, "example.many", 28);
    plugin(&core, &home, "example.git", 2);
    plugin(&core, &home, "example.notes", 1);
    say(&core, &deliveries, "what can I do here?", Some(views()));

    let turns = brain.turns.lock().unwrap().clone();
    let words = texts(&turns[0]);
    let lines: Vec<&str> = words[0].lines().collect();
    assert_eq!(
        &lines[1..],
        [
            "Screen 1440×900, desktop \"Code\" (2 of 3) in front, 2 window(s), front to back:",
            "- w1: Git (example.git) (focused), right, at 760,40 size 640×800",
            "  example.git tools: example_git_c0, example_git_c1",
            "- mail: Mail (example.mail) (put away in the drawer), at 200,120 size 560×400",
            "On the other desktops:",
            "- \"Writing\" (desktop 1): w2: Notes (example.notes), at 40,40 size 600×400",
            "- \"3\" (desktop 3): no windows",
            "Closed recently, the last first (desk.windows.reopen brings one back where it was):",
            "- term: Terminal (example.terminal), on \"Code\", at 80,480 size 720×360, closed \
             2026-11-08T09:12:30.000Z",
            "What the person can do: 142 commands, 118 available now, 40 with keys \
             (desk.capabilities lists each with its title, owner, keys and whether it is \
             available now). Plugins that are on:",
            "- Git (example.git): 2 commands, window open",
            "- Terminal (example.terminal): 6 commands, none available now",
            "[The person says:]",
        ]
    );
    assert_eq!(words[1], "what can I do here?");
    // 31 agent commands do not fit: those on screen come first, then those on other desktops.
    assert_eq!(
        names(&turns[0]),
        [
            "desk-tools",
            "desk-run",
            "example_git_c0",
            "example_git_c1",
            "example_notes_c0"
        ]
    );
}

#[test]
fn a_crowded_desk_is_cut_in_order_to_stay_within_the_budget() {
    let echo = Echo::start();
    let home = home("desk-context-budget");
    let (core, brain, deliveries) = core(&echo, &home);
    let long = "a long title ".repeat(15);
    let window = |n: usize, desktop: usize| {
        json!({ "id": format!("w{n}"), "x": 40 * n, "y": 20, "w": 400, "h": 300,
                "desktop": format!("d{desktop}"), "focused": n == 0,
                "panes": [pane(&format!("example.p{n}"), &long)] })
    };
    let windows: Vec<Value> = (0..64)
        .map(|n| window(n, if n < 4 { 0 } else { 1 + n % 31 }))
        .collect();
    let desktops: Vec<Value> = (0..32)
        .map(
            |n| json!({ "id": format!("d{n}"), "name": format!("Desktop {n}"), "current": n == 0 }),
        )
        .collect();
    let closed: Vec<Value> = (0..20)
        .map(|n| {
            json!({ "id": format!("c{n}"), "title": long, "x": 0, "y": 0, "w": 300, "h": 200,
                         "desktop": "d1", "closedAt": "2026-11-08T09:00:00Z" })
        })
        .collect();
    let plugins: Vec<Value> = (0..128)
        .map(|n| json!({ "id": format!("example.p{n}"), "title": long, "commands": 3, "available": 3 }))
        .collect();
    let desk = json!({ "screen": { "w": 1440, "h": 900 }, "windows": windows, "desktops": desktops,
        "closed": closed,
        "capabilities": { "commands": 384, "available": 384, "keyed": 0, "plugins": plugins } });
    say(&core, &deliveries, "hello", Some(desk.clone()));
    say(&core, &deliveries, "hello", Some(desk));

    let turns = brain.turns.lock().unwrap().clone();
    let words = &texts(&turns[0])[0];
    let size = words.chars().count();
    assert!(size <= 8192, "{size} characters");
    assert_eq!(words, &texts(&turns[1])[0], "the same desk, the same words");
    let on_screen = (0..4).all(|n| words.contains(&format!("\n- w{n}: ")));
    assert!(on_screen, "the windows on screen are never cut");
    let lines: Vec<&str> = words.lines().collect();
    let cut = |command: &str| {
        let more = format!("more ({command})");
        lines
            .iter()
            .any(|l| l.starts_with("- … and ") && l.ends_with(&more))
    };
    let parts = [
        "desk.windows.list",
        "desk.windows.closed",
        "desk.capabilities",
    ];
    assert!(parts.iter().all(|c| cut(c)), "each part is cut:\n{words}");
    assert!(words.contains("What the person can do: 384 commands"));
    assert_eq!(lines.last(), Some(&"[The person says:]"));
}
