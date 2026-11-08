//! Runs of agents.ask: the program runs once without a shell, in its non-interactive mode, with the
//! arguments plugins/local-agents/ui/catalog.js gives it (read-only access is Claude Code's plan
//! mode and Codex's read-only sandbox; no flag that widens a program's permissions is passed). Its
//! output lines become agents.run steps for the callers named at the start, in order: each step is
//! published while the runs are locked. The last 50 runs are kept; a run that ends drops its
//! process.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use desk_bridge::{
    AgentsRunEvent, BridgeEvent, LocalAgentAccess, LocalAgentId, LocalAgentRun, LocalAgentRunData,
    LocalAgentRunKind, LocalAgentRunState,
};
use desk_sys::proc::{self as sysproc, Event, Process, SpawnOptions, Stream};

use super::output::{Step, steps};
use super::{TEXT_MAX, clip};
use crate::events::EventBus;
use crate::sync::lock;
use crate::time::rfc3339_now;

/// How many runs are kept.
const KEEP: usize = 50;
/// How long a stopped program has to end before it is killed.
const GRACE: Duration = Duration::from_secs(3);
/// How much of the program's error output is kept, for a run that fails.
const STDERR_MAX: usize = 4000;

/// What one ask runs.
pub(crate) struct AskPlan {
    pub(crate) agent: LocalAgentId,
    pub(crate) program: PathBuf,
    pub(crate) args: Vec<String>,
    pub(crate) cwd: PathBuf,
    pub(crate) path: Option<String>,
    pub(crate) prompt: String,
    pub(crate) session_id: Option<String>,
    pub(crate) access: LocalAgentAccess,
    pub(crate) caller: String,
    /// Who hears the run's steps.
    pub(crate) to: Vec<String>,
}

struct Entry {
    run: LocalAgentRun,
    process: Option<Process>,
    to: Vec<String>,
    pending: Vec<u8>,
    stderr: String,
    answer: Option<String>,
    fatal: Option<String>,
}

#[derive(Default)]
pub(crate) struct Runs {
    next: u64,
    entries: VecDeque<Entry>,
}

impl Runs {
    /// Every run kept, the newest first.
    pub(crate) fn all(&self) -> impl Iterator<Item = &LocalAgentRun> {
        self.entries.iter().rev().map(|e| &e.run)
    }

    fn entry(&mut self, id: &str) -> Option<&mut Entry> {
        self.entries.iter_mut().find(|e| e.run.run_id == id)
    }

    /// Room for one more: the oldest run that ended goes once more than `KEEP` are kept.
    fn make_room(&mut self) {
        while self.entries.len() >= KEEP {
            let ended = self
                .entries
                .iter()
                .position(|e| e.run.state != LocalAgentRunState::Running);
            match ended {
                Some(at) => {
                    self.entries.remove(at);
                }
                None => return,
            }
        }
    }
}

/// Start `plan`: the run as it starts, or why its program could not start.
pub(crate) fn start(
    runs: &Arc<Mutex<Runs>>,
    events: EventBus,
    plan: AskPlan,
) -> Result<LocalAgentRun, desk_sys::Error> {
    let mut table = lock(runs);
    table.make_room();
    table.next += 1;
    let run_id = format!("run-{}", table.next);
    let run = LocalAgentRun {
        run_id: run_id.clone(),
        agent: plan.agent,
        caller: plan.caller.clone(),
        prompt: clip(&plan.prompt, 500).0,
        cwd: plan.cwd.display().to_string(),
        session_id: plan.session_id.clone(),
        access: plan.access,
        state: LocalAgentRunState::Running,
        started_at: rfc3339_now(),
        ended_at: None,
        text: String::new(),
        tools: 0,
        error: None,
    };
    let mut env = std::collections::BTreeMap::new();
    if let Some(path) = &plan.path {
        env.insert("PATH".to_owned(), path.clone());
    }
    let options = SpawnOptions {
        program: plan.program.display().to_string(),
        args: plan.args,
        cwd: Some(plan.cwd),
        env,
        pty: None,
    };
    let report = reporter(run_id.clone(), Arc::downgrade(runs), events.clone());
    // The table stays locked until the entry is in it, so the reporter finds it.
    let process = sysproc::spawn(&options, report)?;
    table.entries.push_back(Entry {
        run: run.clone(),
        process: Some(process),
        to: plan.to.clone(),
        pending: Vec::new(),
        stderr: String::new(),
        answer: None,
        fatal: None,
    });
    publish(
        &events,
        &plan.to,
        step(&run, LocalAgentRunKind::Started, Some(run.clone())),
    );
    Ok(run)
}

/// Stop a run that is going on; None when it ended or is not kept.
pub(crate) fn stop(runs: &Arc<Mutex<Runs>>, id: &str) -> Option<LocalAgentRun> {
    let mut table = lock(runs);
    let entry = table.entry(id)?;
    if entry.run.state != LocalAgentRunState::Running {
        return None;
    }
    entry.run.state = LocalAgentRunState::Stopped;
    entry.run.ended_at = Some(rfc3339_now());
    if let Some(process) = &entry.process {
        let _ = process.kill(sysproc::Signal::Term);
    }
    let run = entry.run.clone();
    drop(table);
    let runs = Arc::downgrade(runs);
    let id = id.to_owned();
    std::thread::spawn(move || {
        std::thread::sleep(GRACE);
        if let Some(runs) = runs.upgrade()
            && let Some(entry) = lock(&runs).entry(&id)
            && let Some(process) = &entry.process
        {
            let _ = process.kill(sysproc::Signal::Kill);
        }
    });
    Some(run)
}

fn step(
    run: &LocalAgentRun,
    kind: LocalAgentRunKind,
    whole: Option<LocalAgentRun>,
) -> LocalAgentRunData {
    LocalAgentRunData {
        run_id: run.run_id.clone(),
        agent: run.agent,
        kind,
        text: None,
        tool: None,
        detail: None,
        session_id: run.session_id.clone(),
        run: whole,
    }
}

fn publish(events: &EventBus, to: &[String], data: LocalAgentRunData) {
    let event = AgentsRunEvent {
        event: Default::default(),
        data,
    };
    events.publish_to(to.to_vec(), BridgeEvent::AgentsRun(event));
}

/// The callback of one run's program.
fn reporter(
    id: String,
    runs: Weak<Mutex<Runs>>,
    events: EventBus,
) -> impl FnMut(Event) + Send + 'static {
    move |event| {
        let Some(runs) = runs.upgrade() else {
            return;
        };
        let mut table = lock(&runs);
        let Some(entry) = table.entry(&id) else {
            return;
        };
        match event {
            Event::Output {
                stream: Stream::Stdout | Stream::Pty,
                data,
            } => {
                entry.pending.extend_from_slice(&data);
                while let Some(at) = entry.pending.iter().position(|b| *b == b'\n') {
                    let line: Vec<u8> = entry.pending.drain(..=at).collect();
                    read_line(entry, &line, &events);
                }
            }
            Event::Output {
                stream: Stream::Stderr,
                data,
            } => {
                entry.stderr.push_str(&String::from_utf8_lossy(&data));
                if entry.stderr.len() > STDERR_MAX {
                    let cut = entry.stderr.len() - STDERR_MAX;
                    let at = (cut..entry.stderr.len())
                        .find(|i| entry.stderr.is_char_boundary(*i))
                        .unwrap_or(0);
                    entry.stderr.drain(..at);
                }
            }
            Event::Exit(exit) => {
                let rest = std::mem::take(&mut entry.pending);
                read_line(entry, &rest, &events);
                let process = entry.process.take();
                end(entry, exit.code, &events);
                drop(table);
                drop(process);
            }
        }
    }
}

/// One line of the program's output: its steps, applied to the run and published.
fn read_line(entry: &mut Entry, line: &[u8], events: &EventBus) {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(line) else {
        return;
    };
    for s in steps(entry.run.agent, &value) {
        match s {
            Step::Session(id) => entry.run.session_id = Some(id),
            Step::Text(text) => {
                let joined = if entry.run.text.is_empty() {
                    text.clone()
                } else {
                    format!("{}\n\n{text}", entry.run.text)
                };
                entry.run.text = clip(&joined, TEXT_MAX).0;
                let mut data = step(&entry.run, LocalAgentRunKind::Text, None);
                data.text = Some(clip(&text, TEXT_MAX).0);
                publish(events, &entry.to, data);
            }
            Step::Tool(name, detail) => {
                entry.run.tools += 1;
                let mut data = step(&entry.run, LocalAgentRunKind::Tool, None);
                data.tool = Some(clip(&name, 128).0);
                data.detail = (!detail.is_empty()).then(|| clip(&detail, 500).0);
                publish(events, &entry.to, data);
            }
            Step::Final(answer) => entry.answer = Some(answer),
            Step::Error(why, true) => entry.fatal = Some(why),
            Step::Error(..) => {}
        }
    }
}

/// The run's end: stopped when agents.stop ended it, failed when the program said so or exited
/// with an error and no answer, else done with its answer.
fn end(entry: &mut Entry, code: Option<i32>, events: &EventBus) {
    let run = &mut entry.run;
    let kind = if run.state == LocalAgentRunState::Stopped {
        LocalAgentRunKind::Stopped
    } else {
        run.ended_at = Some(rfc3339_now());
        let answered = entry.answer.is_some() || !run.text.is_empty();
        let failed = entry.fatal.is_some() || (code != Some(0) && !answered);
        if failed {
            run.state = LocalAgentRunState::Failed;
            let why = entry.fatal.clone().or_else(|| {
                let said = entry.stderr.trim();
                (!said.is_empty()).then(|| said.to_owned())
            });
            let why = why.unwrap_or_else(|| match code {
                Some(code) => format!("The program ended with code {code}."),
                None => "The program was ended.".to_owned(),
            });
            run.error = Some(clip(&why, 2000).0);
            LocalAgentRunKind::Failed
        } else {
            run.state = LocalAgentRunState::Done;
            if let Some(answer) = &entry.answer {
                run.text = clip(answer, TEXT_MAX).0;
            }
            LocalAgentRunKind::Done
        }
    };
    let whole = run.clone();
    publish(events, &entry.to, step(&whole, kind, Some(whole.clone())));
}
