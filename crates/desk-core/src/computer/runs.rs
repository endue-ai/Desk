//! What the person sees of the computer's use (ADR 0123): `computer.activity` for the banner, and
//! every act of an agent on its run (ADR 0100) with a screenshot of the main display after it, kept
//! as a PNG in the screenshots folder (the newest `MAX_SHOTS`). The run's `raw.computer.steps`
//! holds the steps, its body says them in words, and its deep link opens the latest screenshot.

use std::fs;
use std::path::Path;

use desk_bridge::{
    ApprovalAction, BridgeError, BridgeEvent, ComputerActivityData, ComputerActivityEvent,
    ComputerActivityState, ComputerSeePermission, Permission, RunState,
};
use desk_computer::screen::{Capture, Target};
use serde_json::{Value, json};

use super::act::Acting;
use crate::agent_runs::{RUNS, clip};
use crate::core_perm::perm_manage;
use crate::handler::Core;

/// The screenshots kept, the oldest removed first.
const MAX_SHOTS: usize = 300;
/// The steps a run keeps, the oldest dropped first.
const MAX_STEPS: usize = 50;
/// A screenshot after an act is at most this many pixels.
const SHOT: (u32, u32) = (1280, 800);

impl Core {
    /// `computer.activity` to the perm:manage holders and the holders of computer:see without apps.
    pub(crate) fn activity(
        &self,
        state: ComputerActivityState,
        caller: &str,
        agent: Option<&str>,
        action: Option<&str>,
        app: Option<&str>,
        run: Option<&str>,
    ) {
        let see = Permission::ComputerSee(ComputerSeePermission {
            permission: Default::default(),
            apps: None,
        });
        let mut to = self.holders(&perm_manage());
        to.extend(self.holders(&see));
        to.sort();
        to.dedup();
        let data = ComputerActivityData {
            state,
            caller: caller.to_owned(),
            agent: agent.map(str::to_owned),
            action: action.map(str::to_owned),
            app: app.map(str::to_owned),
            run_id: run.map(str::to_owned),
        };
        let event = BridgeEvent::ComputerActivity(ComputerActivityEvent {
            event: Default::default(),
            data,
        });
        self.events().publish_to(to, event);
    }

    /// An agent's act ended: a step on its run with a screenshot after it, and the run of an
    /// agent's own call ends with it.
    pub(super) fn act_ended(
        &self,
        acting: &Acting,
        summary: &str,
        app: &str,
        outcome: Result<(), &BridgeError>,
    ) {
        let Some(run) = &acting.run else { return };
        let shot = outcome.is_ok().then(|| self.shot_after(run)).flatten();
        let mut step = json!({ "action": summary, "app": app, "at": self.now_text(),
            "ok": outcome.is_ok() });
        if let Some(url) = &shot {
            step["screenshot"] = json!(url);
        }
        if let Err(failed) = outcome {
            step["error"] = json!(failed.message);
        }
        self.change_run(RUNS, run, |item| {
            let raw = item.raw.get_or_insert_with(Default::default);
            let steps = raw
                .entry("computer")
                .or_insert_with(|| json!({ "steps": [] }))
                .get_mut("steps")
                .and_then(Value::as_array_mut);
            if let Some(steps) = steps {
                steps.push(step);
                let extra = steps.len().saturating_sub(MAX_STEPS);
                steps.drain(..extra);
                item.body = Some(body(steps));
            }
            if let Some(url) = shot {
                item.deep_link = Some(url);
            }
            if !acting.delegated {
                item.title = clip(summary, 200);
            }
        });
        if !acting.delegated {
            let (state, text) = match outcome {
                Ok(()) => (RunState::Done, summary.to_owned()),
                Err(e) if e.code == desk_bridge::ErrorCode::Cancelled => {
                    (RunState::Cancelled, e.message.clone())
                }
                Err(e) => (RunState::Failed, e.message.clone()),
            };
            self.end_run(RUNS, run, state, Some(text));
        }
    }

    /// A screenshot of the main display after an act, kept in the screenshots folder; its file URL.
    /// Nothing without a folder, or when the OS does not let the desk see the screen.
    fn shot_after(&self, run: &str) -> Option<String> {
        let dir = self.computer.shots()?;
        let computer = self.computer.computer().ok()?;
        let capture = Capture::of(Target::MainDisplay).fit(SHOT.0, SHOT.1);
        let shot = computer.screenshot(&capture).ok()?;
        fs::create_dir_all(&dir).ok()?;
        let name = format!("{:06}-{run}.png", self.computer.next_shot());
        let file = dir.join(name);
        fs::write(&file, &shot.png).ok()?;
        prune(&dir);
        Some(file_url(&file))
    }
}

/// The run's body: each step in words, with where its screenshot is.
fn body(steps: &[Value]) -> String {
    let line = |(n, step): (usize, &Value)| {
        let action = step["action"].as_str().unwrap_or_default();
        let mut text = format!("{}. {action}", n + 1);
        if let Some(error) = step["error"].as_str() {
            text.push_str(&format!(" (failed: {error})"));
        }
        if let Some(url) = step["screenshot"].as_str() {
            text.push_str(&format!(" [screenshot]({url})"));
        }
        text
    };
    steps
        .iter()
        .enumerate()
        .map(line)
        .collect::<Vec<_>>()
        .join("\n")
}

/// Keep the newest `MAX_SHOTS` screenshots; names sort by when they were taken.
fn prune(dir: &Path) {
    let Ok(read) = fs::read_dir(dir) else { return };
    let mut shots: Vec<_> = read
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|e| e == "png"))
        .collect();
    shots.sort();
    let extra = shots.len().saturating_sub(MAX_SHOTS);
    for old in &shots[..extra] {
        let _ = fs::remove_file(old);
    }
}

/// `file:///…` with everything but unreserved characters and `/` percent-encoded.
pub(crate) fn file_url(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    let mut url = String::from("file://");
    if !text.starts_with('/') {
        url.push('/');
    }
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' | b':' => {
                url.push(byte as char)
            }
            _ => url.push_str(&format!("%{byte:02X}")),
        }
    }
    url
}

/// The method an act is, as a run's command names it.
pub(crate) fn method_name(method: ApprovalAction) -> &'static str {
    match method {
        ApprovalAction::ComputerInputClick => "computer.input.click",
        ApprovalAction::ComputerInputMove => "computer.input.move",
        ApprovalAction::ComputerInputDrag => "computer.input.drag",
        ApprovalAction::ComputerInputScroll => "computer.input.scroll",
        ApprovalAction::ComputerInputType => "computer.input.type",
        ApprovalAction::ComputerInputKeys => "computer.input.keys",
        ApprovalAction::ComputerAxPerform => "computer.ax.perform",
        ApprovalAction::ComputerAppsLaunch => "computer.apps.launch",
        ApprovalAction::ComputerAppsActivate => "computer.apps.activate",
        ApprovalAction::ComputerAppsQuit => "computer.apps.quit",
        _ => "computer",
    }
}
