//! computer.* (ADR 0120, ADR 0123): the computer served through the desk-computer driver the app
//! injects (`Core::with_computer`). Reads need `computer:see` (`computer/read.rs`); acts need
//! `computer:control` and take one pipeline (`computer/act.rs`): the scope's apps, an agent's
//! allowlist and the person's approval, the banner's activity, the run with its screenshots.
//! `computer.stop` raises the desk's one stop flag: running and queued acts end `cancelled` and new
//! ones are refused until the person resumes. Without a driver every call is `unsupported`.

use std::path::PathBuf;
use std::sync::Arc;

use desk_bridge::{
    ApprovalAction, BridgeRequest, ComputerActivityState, ComputerStopParams, ComputerStopResult,
    ErrorCode, Permission, RequestId,
};
use desk_computer::apps::{AppOp, Launch};
use desk_computer::input::Mouse;
use desk_computer::keys::Chord;
use desk_computer::{Action, Computer};

use crate::agents::agent_of;
use crate::computer::map::{self, invalid};
use crate::computer::{Act, Reach};
use crate::handler::{Answer, Core, error, json, sys_error};
use crate::perm::Target;

/// Who the stop key and the app call as.
const CORE: &str = "core";

impl Core {
    /// Serve computer.* through `computer`: the OS driver in the app, the fake in tests.
    pub fn with_computer(self, computer: Arc<dyn Computer>) -> Self {
        self.computer.serve(computer);
        self
    }

    /// Keep a screenshot after every act of an agent in `dir` (ADR 0123).
    pub fn with_computer_shots(self, dir: PathBuf) -> Self {
        self.computer.keep_shots(dir);
        self
    }

    /// `with_computer` and `with_computer_shots` on a shared core, before plugins install.
    pub fn serve_computer(&self, computer: Arc<dyn Computer>, shots: Option<PathBuf>) {
        self.computer.serve(computer);
        if let Some(dir) = shots {
            self.computer.keep_shots(dir);
        }
    }

    /// The person's emergency stop (the global stop key): what runs and waits ends `cancelled`, and
    /// nothing acts until they resume. Answers whether it was raised just now.
    pub fn stop_computer(&self) -> bool {
        let flag = self.computer.stop_flag();
        let was = flag.is_raised();
        flag.raise();
        if !was {
            self.activity(ComputerActivityState::Stopped, CORE, None, None, None, None);
        }
        !was
    }

    /// The person lets agents use the computer again after a stop (the banner's Resume).
    pub fn resume_computer(&self) {
        let flag = self.computer.stop_flag();
        if flag.is_raised() {
            flag.clear();
            self.activity(ComputerActivityState::Resumed, CORE, None, None, None, None);
        }
    }

    /// Whether the stop is raised.
    pub fn computer_stopped(&self) -> bool {
        self.computer.stop_flag().is_raised()
    }

    /// Every computer.* request: its id and its answer.
    pub(crate) fn computer_call(
        &self,
        caller: &str,
        request: BridgeRequest,
    ) -> (RequestId, Answer) {
        use BridgeRequest as R;
        match request {
            R::ComputerPermissionsStatus(r) => (r.id, self.computer_status(caller, r.params)),
            R::ComputerPermissionsRequest(r) => (r.id, self.computer_request(caller, r.params)),
            R::ComputerPermissionsOpen(r) => (r.id, self.computer_open(caller, r.params)),
            R::ComputerScreenshot(r) => (r.id, self.computer_screenshot(caller, r.params)),
            R::ComputerWindows(r) => (r.id, self.computer_windows(caller, r.params)),
            R::ComputerAppsList(r) => (r.id, self.computer_apps(caller, r.params)),
            R::ComputerAxTree(r) => (r.id, self.computer_tree(caller, r.params)),
            R::ComputerAxFind(r) => (r.id, self.computer_find(caller, r.params)),
            R::ComputerStop(r) => (r.id, self.computer_stop(caller, r.params)),
            R::ComputerAppsLaunch(r) => {
                let p = r.params;
                let (launch, reach) = match (p.bundle_id, p.path) {
                    (Some(id), None) => (Launch::BundleId(id.clone()), Reach::Bundle(id)),
                    (None, Some(path)) => (Launch::Path(path), Reach::Unknown),
                    _ => return (r.id, Err(invalid("give bundleId or path".to_owned()))),
                };
                let act = Act {
                    method: ApprovalAction::ComputerAppsLaunch,
                    actions: vec![Action::Launch(launch)],
                    reach,
                    scope: p.scope,
                    invocation: p.invocation_id,
                };
                (r.id, self.computer_act(caller, act))
            }
            R::ComputerAppsActivate(r) => {
                let p = r.params;
                (r.id, self.app_act(caller, p, AppOp::Activate))
            }
            R::ComputerAppsQuit(r) => {
                let p = r.params;
                (r.id, self.app_act(caller, p, AppOp::Quit))
            }
            R::ComputerAxPerform(r) => {
                let p = r.params;
                let answer = map::element_ref(&p.element).and_then(|element| {
                    let pid = element.pid;
                    let action = Action::Perform {
                        element,
                        action: map::ax_action(p.action),
                    };
                    let act = Act {
                        method: ApprovalAction::ComputerAxPerform,
                        actions: vec![action],
                        reach: Reach::Pid(pid),
                        scope: p.scope,
                        invocation: p.invocation_id,
                    };
                    self.computer_act(caller, act)
                });
                (r.id, answer)
            }
            R::ComputerInputClick(r) => {
                let p = r.params;
                let at = desk_computer::Point::new(p.x, p.y);
                let count = p.count.map_or(1, |c| c.min(3) as u8);
                let mouse = Mouse::Click {
                    at,
                    button: map::button(p.button),
                    count,
                };
                let act = mouse_act(ApprovalAction::ComputerInputClick, mouse, Reach::Point(at));
                (
                    r.id,
                    self.computer_act(caller, act(p.scope, p.invocation_id)),
                )
            }
            R::ComputerInputMove(r) => {
                let p = r.params;
                let to = desk_computer::Point::new(p.x, p.y);
                let act = mouse_act(
                    ApprovalAction::ComputerInputMove,
                    Mouse::Move { to },
                    Reach::Point(to),
                );
                (
                    r.id,
                    self.computer_act(caller, act(p.scope, p.invocation_id)),
                )
            }
            R::ComputerInputDrag(r) => {
                let p = r.params;
                let (from, to) = (map::point(&p.from), map::point(&p.to));
                let drag = Mouse::Drag { from, to };
                let act = mouse_act(
                    ApprovalAction::ComputerInputDrag,
                    drag,
                    Reach::Drag(from, to),
                );
                (
                    r.id,
                    self.computer_act(caller, act(p.scope, p.invocation_id)),
                )
            }
            R::ComputerInputScroll(r) => {
                let p = r.params;
                let at = p.at.as_ref().map(map::point);
                let lines = |n: Option<i64>| n.unwrap_or(0).clamp(-100, 100) as i32;
                let scroll = Mouse::Scroll {
                    at,
                    dx: lines(p.dx),
                    dy: lines(p.dy),
                };
                let reach = at.map_or(Reach::Frontmost, Reach::Point);
                let act = mouse_act(ApprovalAction::ComputerInputScroll, scroll, reach);
                (
                    r.id,
                    self.computer_act(caller, act(p.scope, p.invocation_id)),
                )
            }
            R::ComputerInputType(r) => {
                let p = r.params;
                let act = Act {
                    method: ApprovalAction::ComputerInputType,
                    actions: vec![Action::Text(p.text)],
                    reach: Reach::Frontmost,
                    scope: p.scope,
                    invocation: p.invocation_id,
                };
                (r.id, self.computer_act(caller, act))
            }
            R::ComputerInputKeys(r) => {
                let p = r.params;
                let chords = p.keys.iter().map(|k| Chord::parse(k).map(Action::Key));
                let answer = chords
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(sys_error)
                    .and_then(|actions| {
                        let act = Act {
                            method: ApprovalAction::ComputerInputKeys,
                            actions,
                            reach: Reach::Frontmost,
                            scope: p.scope,
                            invocation: p.invocation_id,
                        };
                        self.computer_act(caller, act)
                    });
                (r.id, answer)
            }
            other => {
                let wrong = format!("{other:?} is not a computer.* call");
                (0, Err(error(ErrorCode::Internal, wrong)))
            }
        }
    }

    fn app_act(&self, caller: &str, p: desk_bridge::ComputerAppParams, op: AppOp) -> Answer {
        let pid = map::pid(p.pid)?;
        let method = match op {
            AppOp::Activate => ApprovalAction::ComputerAppsActivate,
            AppOp::Hide | AppOp::Quit => ApprovalAction::ComputerAppsQuit,
        };
        let act = Act {
            method,
            actions: vec![Action::App { pid, op }],
            reach: Reach::Pid(pid),
            scope: p.scope,
            invocation: p.invocation_id,
        };
        self.computer_act(caller, act)
    }

    /// computer.stop: raise the stop, or lower it again (`resume`), which an agent may not.
    fn computer_stop(&self, caller: &str, params: ComputerStopParams) -> Answer {
        self.computer.control()?;
        let resume = params.resume == Some(true);
        let scope = Permission::ComputerControl(params.scope);
        self.check(caller, &scope, &Target::None)?;
        let flag = self.computer.stop_flag();
        if resume {
            if agent_of(caller).is_some() {
                let only = "only the person resumes computer use after a stop";
                return Err(crate::handler::denied(crate::perm::Denied {
                    permission: scope,
                    reason: only.to_owned(),
                }));
            }
            if flag.is_raised() {
                flag.clear();
                self.activity(
                    ComputerActivityState::Resumed,
                    caller,
                    None,
                    None,
                    None,
                    None,
                );
            }
        } else if !flag.is_raised() {
            flag.raise();
            self.activity(
                ComputerActivityState::Stopped,
                caller,
                None,
                None,
                None,
                None,
            );
        }
        json(ComputerStopResult {
            stopped: flag.is_raised(),
        })
    }
}

/// A mouse act: its method, the mouse action and the app it reaches, waiting for its scope and
/// invocation.
fn mouse_act(
    method: ApprovalAction,
    mouse: Mouse,
    reach: Reach,
) -> impl FnOnce(desk_bridge::ComputerControlPermission, Option<String>) -> Act {
    move |scope, invocation| Act {
        method,
        actions: vec![Action::Mouse(mouse)],
        reach,
        scope,
        invocation,
    }
}
