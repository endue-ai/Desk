//! Runs (ADR 0100): one piece of an agent's work, kept as an item of kind `run` so every view can
//! draw it. The core records a run for every command an agent caller (`agent:<id>`) asks for: it is
//! `running` from cmd.invoke, `waiting` while held for the person's approval (with the approval's
//! id), and ends `done`, `failed` or `cancelled` with its answer cut short. The brain directory's A2A
//! tasks become runs of their target agent when brain.tasks.list answers, and a plugin reports the
//! runs of the agents it runs with agent.report (`core_agents`). This session's runs live here and,
//! when the desk has one, in the item index too.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::sync::MutexGuard;

use desk_bridge::{Item, ItemSource, RunItem, RunState};
use serde_json::{Map, Value};

use crate::agents::agent_of;
use crate::handler::Core;
use crate::time::rfc3339_millis;

/// The source of the runs the core records itself.
pub(crate) const RUNS: &str = "desk.agents";
/// The longest result a run keeps.
const RESULT_MAX: usize = 500;
/// The longest prompt a run's title quotes.
const TITLE_PROMPT: usize = 80;

thread_local! {
    /// The run the call on this thread is, while the core holds it for approval.
    static HELD: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// One run, with who started it and how to reach what runs it.
#[derive(Clone)]
pub(crate) struct Run {
    pub(crate) item: RunItem,
    /// The command invocation it is, for the core's own runs.
    pub(crate) invocation: Option<String>,
}

/// This session's runs by `(connector, id)`, and the run each invocation is.
#[derive(Default)]
pub(crate) struct Runs {
    next: u64,
    pub(crate) by_key: BTreeMap<(String, String), Run>,
    by_invocation: BTreeMap<String, String>,
    /// The agents plugins reported runs of, by registry id: name and brain.
    reported: BTreeMap<String, (String, Option<String>)>,
}

impl Core {
    /// A run for `caller`'s call of the command `id`, when the caller is an agent: running, until
    /// the hold (`held_as`) or the answer says otherwise. Answers its id.
    pub(crate) fn run_started(
        &self,
        caller: &str,
        id: &str,
        args: Option<&Map<String, Value>>,
    ) -> Option<String> {
        let agent = agent_of(caller)?.to_owned();
        let title = self.command(id).map_or_else(|| id.to_owned(), |c| c.title);
        let title = match args.and_then(|a| a.get("prompt")).and_then(Value::as_str) {
            Some(prompt) => format!("{title}: {}", clip(prompt, TITLE_PROMPT)),
            None => title,
        };
        let now = self.now_text();
        let run_id = {
            let mut runs = self.runs();
            runs.next += 1;
            format!("run-{}", runs.next)
        };
        let item = RunItem {
            id: run_id.clone(),
            source: source(RUNS),
            kind: Default::default(),
            title,
            updated_at: now.clone(),
            created_at: None,
            deep_link: None,
            body: None,
            raw: None,
            agent,
            state: RunState::Running,
            started_at: now,
            ended_at: None,
            result: None,
            command: Some(id.to_owned()),
            approval: None,
        };
        self.keep_run(Run {
            item,
            invocation: None,
        });
        Some(run_id)
    }

    /// Run `call` with `run` as the thread's held run, so an approval it waits for marks it waiting.
    pub(crate) fn held_as<T>(&self, run: Option<&str>, call: impl FnOnce() -> T) -> T {
        let before = HELD.with(|h| h.replace(run.map(str::to_owned)));
        let out = call();
        HELD.with(|h| h.replace(before));
        out
    }

    /// The thread's held run waits for the approval `approval_id`.
    pub(crate) fn run_waits(&self, approval_id: &str) {
        let Some(run) = HELD.with(|h| h.borrow().clone()) else {
            return;
        };
        self.change_run(RUNS, &run, |item| {
            item.state = RunState::Waiting;
            item.approval = Some(approval_id.to_owned());
        });
    }

    /// The run went on (`Ok`, approved or never held) as `invocation`, or was refused.
    pub(crate) fn run_went_on(&self, run: &str, invocation: Result<&str, &str>) {
        match invocation {
            Ok(invocation) => {
                let mut runs = self.runs();
                runs.by_invocation
                    .insert(invocation.to_owned(), run.to_owned());
                if let Some(kept) = runs.by_key.get_mut(&key(RUNS, run)) {
                    kept.invocation = Some(invocation.to_owned());
                }
                drop(runs);
                self.change_run(RUNS, run, |item| {
                    item.state = RunState::Running;
                    item.approval = None;
                });
            }
            Err(why) => self.end_run(RUNS, run, RunState::Cancelled, Some(why.to_owned())),
        }
    }

    /// The invocation was answered: its run, if any, ends with the answer.
    pub(crate) fn run_answered(
        &self,
        invocation: &str,
        result: Option<&Value>,
        failure: Option<(bool, &str)>,
    ) {
        let run = self.runs().by_invocation.remove(invocation);
        let Some(run) = run else { return };
        let (state, text) = match failure {
            None => (RunState::Done, result.map(summary)),
            Some((true, why)) => (RunState::Cancelled, Some(why.to_owned())),
            Some((false, why)) => (RunState::Failed, Some(why.to_owned())),
        };
        self.end_run(RUNS, &run, state, text);
    }

    /// End a run: its state, when it ended and its short result.
    pub(crate) fn end_run(
        &self,
        connector: &str,
        run: &str,
        state: RunState,
        result: Option<String>,
    ) {
        let now = self.now_text();
        self.change_run(connector, run, |item| {
            item.state = state;
            item.approval = None;
            item.ended_at = Some(now.clone());
            item.result = result.map(|r| clip(&r, RESULT_MAX));
        });
    }

    /// Change a kept run and publish it.
    pub(crate) fn change_run(&self, connector: &str, run: &str, change: impl FnOnce(&mut RunItem)) {
        let changed = {
            let mut runs = self.runs();
            let Some(kept) = runs.by_key.get_mut(&key(connector, run)) else {
                return;
            };
            change(&mut kept.item);
            kept.item.updated_at = self.now_text();
            kept.clone()
        };
        self.publish_run(&changed.item);
    }

    /// Keep `run` (a new one, or one reported again) and publish it.
    pub(crate) fn keep_run(&self, run: Run) {
        let item = run.item.clone();
        let at = key(&item.source.connector, &item.id);
        self.runs().by_key.insert(at, run);
        self.publish_run(&item);
    }

    /// The runs of this session, oldest first.
    pub(crate) fn runs_now(&self) -> Vec<Run> {
        let runs = self.runs();
        let mut all: Vec<Run> = runs.by_key.values().cloned().collect();
        all.sort_by(|a, b| a.item.started_at.cmp(&b.item.started_at));
        all
    }

    /// The A2A tasks the brain listed, as runs of their target agents.
    pub(crate) fn runs_from_tasks(&self, tasks: &[desk_brain::A2ATask]) {
        use desk_brain::A2ATaskStatus as S;
        for task in tasks {
            let state = match task.status {
                S::Submitted | S::Working => RunState::Running,
                S::InputRequired => RunState::Waiting,
                S::Completed => RunState::Done,
                S::Failed => RunState::Failed,
                S::Canceled => RunState::Cancelled,
            };
            let ended = matches!(
                state,
                RunState::Done | RunState::Failed | RunState::Cancelled
            );
            let result = task.error.clone().or_else(|| {
                task.result
                    .as_ref()
                    .map(|r| summary(&Value::Object(r.clone())))
            });
            let item = RunItem {
                id: task.id.clone(),
                source: source(RUNS),
                kind: Default::default(),
                title: task.goal.clone().map_or_else(
                    || format!("A task from {}", task.source_agent_id),
                    |g| clip(&g, 200),
                ),
                updated_at: task.updated_at.clone(),
                created_at: None,
                deep_link: None,
                body: None,
                raw: None,
                agent: task.target_agent_id.clone(),
                state,
                started_at: task.inserted_at.clone(),
                ended_at: ended.then(|| task.updated_at.clone()),
                result: result.map(|r| clip(&r, RESULT_MAX)),
                command: None,
                approval: None,
            };
            self.keep_run(Run {
                item,
                invocation: None,
            });
        }
    }

    /// Remember an agent a plugin reported a run of.
    pub(crate) fn remember_reported(&self, agent: &str, name: String, brain: Option<String>) {
        self.runs().reported.insert(agent.to_owned(), (name, brain));
    }

    /// The agents plugins reported runs of: id, name and brain.
    pub(crate) fn reported_agents(&self) -> Vec<(String, (String, Option<String>))> {
        let runs = self.runs();
        runs.reported
            .iter()
            .map(|(id, v)| (id.clone(), v.clone()))
            .collect()
    }

    /// Put the run in the item index, when the desk has one.
    fn publish_run(&self, item: &RunItem) {
        if let Some(index) = &self.index {
            let _ = index.upsert(&[Item::Run(item.clone())]);
        }
    }

    pub(crate) fn now_text(&self) -> String {
        rfc3339_millis(self.clock.now())
    }

    pub(crate) fn runs(&self) -> MutexGuard<'_, Runs> {
        self.runs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

pub(crate) fn source(connector: &str) -> ItemSource {
    ItemSource {
        connector: connector.to_owned(),
        instance: "default".to_owned(),
    }
}

pub(crate) fn key(connector: &str, run: &str) -> (String, String) {
    (connector.to_owned(), run.to_owned())
}

/// What a command answered, in a line: its text, answer, result, summary or message, else the JSON.
fn summary(result: &Value) -> String {
    if let Some(text) = result.as_str() {
        return text.to_owned();
    }
    for field in ["text", "answer", "result", "summary", "message"] {
        if let Some(text) = result.get(field).and_then(Value::as_str) {
            return text.to_owned();
        }
    }
    result.to_string()
}

/// `text` cut to `max` characters, with an ellipsis when cut.
pub(crate) fn clip(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let kept: String = text.chars().take(max - 1).collect();
    format!("{kept}…")
}
