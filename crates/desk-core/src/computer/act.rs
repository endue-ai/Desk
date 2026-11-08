//! The pipeline of every act (ADR 0123). It finds the app the act reaches, checks the caller's
//! `computer:control` and the scope's apps against it, and works out whose act it is: an agent's
//! own (`agent:<id>`), or a plugin's on an agent's invocation (`invocationId`, capped by that
//! agent's allowlist). Then it holds an agent's act for the person's approval (ADR 0078; "Allow
//! for this task" covers the same app until the turn ends), tells the banner, and runs it through
//! the core's `Control`. An agent's act is a run on the runs board, with a screenshot after it.

use std::sync::Arc;

use desk_bridge::{
    ApprovalAction, BridgeError, ComputerActivityState, ComputerControlPermission, ComputerDone,
    ErrorCode, Permission, RunState,
};
use desk_computer::apps::App;
use desk_computer::{Action, Computer, Done, Point};

use super::{app_at, app_of, frontmost, label, map, run};
use crate::agent_runs::RUNS;
use crate::agents::{agent_caller, agent_of};
use crate::approvals::{Action as Approval, in_task};
use crate::handler::{Answer, Core, denied, error, json};
use crate::perm::{Denied, Target};

/// How to find the app an act reaches.
pub(crate) enum Reach {
    /// The app under the pointer at this point (the mouse).
    Point(Point),
    /// A drag: the app it starts on, and the one it ends on.
    Drag(Point, Point),
    /// The frontmost app (the keyboard, and a scroll where the pointer is).
    Frontmost,
    /// A running app by pid.
    Pid(i32),
    /// An app by bundle id, running or not.
    Bundle(String),
    /// No app known before the act (launching by path).
    Unknown,
}

/// One act asked for over the bridge: its method, what it does (a keys call is several chords),
/// the app it reaches, the scope it carries and the invocation it serves.
pub(crate) struct Act {
    pub(crate) method: ApprovalAction,
    pub(crate) actions: Vec<Action>,
    pub(crate) reach: Reach,
    pub(crate) scope: ComputerControlPermission,
    pub(crate) invocation: Option<String>,
}

/// Whose act it is, when it is an agent's: the agent's caller id and the run it is recorded on.
/// `delegated`: a plugin acts on the agent's invocation, whose run is the invocation's.
pub(super) struct Acting {
    pub(super) agent: String,
    pub(super) run: Option<String>,
    pub(super) delegated: bool,
}

impl Core {
    pub(crate) fn computer_act(&self, caller: &str, act: Act) -> Answer {
        let control = self.computer.control()?;
        let computer = Arc::clone(control.computer());
        let (app, end) = reach(computer.as_ref(), &act.reach)?;
        let bundle = app.as_ref().and_then(|a| a.bundle_id.clone());
        let scope = Permission::ComputerControl(act.scope.clone());
        self.check(caller, &scope, &Target::App(bundle.as_deref()))?;
        if let Some(end) = &end {
            let ends = end.as_ref().and_then(|a| a.bundle_id.as_deref());
            self.check(caller, &scope, &Target::App(ends))?;
        }
        let acting = self.acting(caller, act.invocation.as_deref(), &act, bundle.as_deref())?;
        // The desk's own windows hold the person's cards and settings: no agent operates them.
        let desk = std::process::id() as i32;
        let ends_in_desk = matches!(&end, Some(Some(app)) if app.pid == desk);
        if let Some(acting) = &acting
            && (app.as_ref().is_some_and(|a| a.pid == desk) || ends_in_desk)
        {
            let own =
                "an agent may not operate the desk itself: its cards and settings are the person's";
            let refused = error(ErrorCode::PermissionDenied, own.to_owned());
            self.act_ended(acting, own, "endue Desk", Err(&refused));
            return Err(refused);
        }
        let what = act
            .actions
            .iter()
            .map(Action::describe)
            .collect::<Vec<_>>()
            .join(", then ");
        let summary = match &app {
            Some(app) => format!("{what} in {}", app.name),
            None => what.clone(),
        };
        let label = label(app.as_ref());
        if let Some(acting) = &acting {
            let approval = Approval::Computer {
                method: act.method,
                app: bundle.as_deref(),
                label: &label,
                summary: &summary,
            };
            self.approve_act(acting, &scope, approval)?;
        }
        let agent = acting.as_ref().and_then(|a| agent_of(&a.agent));
        let run_id = acting.as_ref().and_then(|a| a.run.clone());
        let name = app.as_ref().map(|a| a.name.as_str());
        let tell = |state| {
            let action = Some(what.as_str());
            self.activity(state, caller, agent, action, name, run_id.as_deref());
        };
        tell(ComputerActivityState::Acting);
        let mut events = 0;
        let mut last: Option<Done> = None;
        for action in act.actions {
            match run(&control, action) {
                Ok(done) => {
                    events += u64::from(done.events);
                    last = Some(done);
                }
                Err(failed) => {
                    tell(ComputerActivityState::Failed);
                    if let Some(acting) = &acting {
                        self.act_ended(acting, &summary, &label, Err(&failed));
                    }
                    return Err(failed);
                }
            }
        }
        tell(ComputerActivityState::Done);
        if let Some(acting) = &acting {
            self.act_ended(acting, &summary, &label, Ok(()));
        }
        let (element, reached) = last.map_or((None, None), |done| (done.element, done.app));
        json(ComputerDone {
            summary,
            events,
            app: reached.or(app).map(map::app),
            element: element.map(|e| map::element(e, None)),
            run_id,
        })
    }

    /// Whose act this is: an agent's own call is a new run of its own; a plugin's act on an agent's
    /// invocation is that agent's, on the invocation's run, within the agent's allowlist. Any other
    /// call is its caller's own.
    fn acting(
        &self,
        caller: &str,
        invocation: Option<&str>,
        act: &Act,
        app: Option<&str>,
    ) -> Result<Option<Acting>, BridgeError> {
        if agent_of(caller).is_some() {
            let run = self.run_started(caller, super::runs::method_name(act.method), None);
            return Ok(Some(Acting {
                agent: caller.to_owned(),
                run,
                delegated: false,
            }));
        }
        let Some((agent, run)) = invocation
            .map(|i| self.invoked_run(caller, i))
            .transpose()?
        else {
            return Ok(None);
        };
        let Some((agent, run)) = agent.zip(run) else {
            return Ok(None);
        };
        let narrowed = Permission::ComputerControl(ComputerControlPermission {
            permission: Default::default(),
            apps: app.map(|app| vec![app.to_owned()]),
        });
        if let Some(reason) = self.capped(&agent, &narrowed) {
            let target = Target::App(app);
            self.refused(&agent, &narrowed, Some(&target), Some(reason));
            let why = format!(
                "{agent}'s allowlist does not let it operate {}",
                app.unwrap_or("the screen")
            );
            return Err(denied(Denied {
                permission: narrowed,
                reason: why,
            }));
        }
        Ok(Some(Acting {
            agent,
            run: Some(run),
            delegated: true,
        }))
    }

    /// The agent and the run of `invocation`, an agent's call of a command `caller` provides that is
    /// still going; `(None, None)` for an invocation no agent made. Another provider's invocation
    /// is `invalid_params`.
    fn invoked_run(
        &self,
        caller: &str,
        invocation: &str,
    ) -> Result<(Option<String>, Option<String>), BridgeError> {
        let found = self.runs().by_key.values().find_map(|run| {
            let going = matches!(run.item.state, RunState::Running | RunState::Waiting);
            (run.item.source.connector == RUNS
                && going
                && run.invocation.as_deref() == Some(invocation))
            .then(|| run.item.clone())
        });
        let Some(item) = found else {
            return Ok((None, None));
        };
        let provider = item.command.as_deref().and_then(|id| self.command(id));
        if provider.is_none_or(|info| info.provider != caller) {
            let theirs = format!("invocation {invocation} is not one of {caller}'s commands");
            return Err(error(ErrorCode::InvalidParams, theirs));
        }
        Ok((agent_caller(&item.agent), Some(item.id)))
    }

    /// Hold the act for the person as its agent's, within the agent's turn; its run waits on the
    /// card. A refused act of the agent's own ends its run.
    fn approve_act(
        &self,
        acting: &Acting,
        scope: &Permission,
        approval: Approval<'_>,
    ) -> Result<(), BridgeError> {
        let hold = || {
            self.held_as(acting.run.as_deref(), || {
                self.hold(&acting.agent, scope, approval)
            })
        };
        let turn = acting
            .delegated
            .then(|| self.turn_of(&acting.agent))
            .flatten();
        let held = match turn {
            Some(turn) => in_task(&turn, hold).0,
            None => hold(),
        };
        if let Some(run) = &acting.run {
            match &held {
                Err(refused) if !acting.delegated => {
                    let why = Some(refused.message.clone());
                    self.end_run(RUNS, run, RunState::Cancelled, why);
                }
                _ => self.change_run(RUNS, run, |item| {
                    item.state = RunState::Running;
                    item.approval = None;
                }),
            }
        }
        held
    }
}

/// The app an act reaches (`None`: the screen) and, for a drag, the one it ends on.
type Reached = (Option<App>, Option<Option<App>>);

fn reach(computer: &dyn Computer, reach: &Reach) -> Result<Reached, BridgeError> {
    Ok(match reach {
        Reach::Point(point) => (app_at(computer, *point)?, None),
        Reach::Drag(from, to) => (app_at(computer, *from)?, Some(app_at(computer, *to)?)),
        Reach::Frontmost => (frontmost(computer)?, None),
        Reach::Pid(pid) => (app_of(computer, *pid)?, None),
        Reach::Bundle(id) => {
            let apps = computer.apps().map_err(crate::handler::sys_error)?;
            let running = apps
                .into_iter()
                .find(|a| a.bundle_id.as_deref() == Some(id));
            let named = || App {
                pid: 0,
                name: id.clone(),
                bundle_id: Some(id.clone()),
                path: None,
                active: false,
                hidden: false,
                regular: true,
            };
            (Some(running.unwrap_or_else(named)), None)
        }
        Reach::Unknown => (None, None),
    })
}
