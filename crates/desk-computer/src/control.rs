//! The one way to act on the computer. An action is planned (and refused with `invalid_params`
//! before anyone is asked if it cannot run), shown to the guard, then queued: one action runs at a
//! time, and each of its events waits for the rate limit and checks the stop flag first. A key or
//! button an action pressed is released again if it stops half-way.

use std::sync::{Arc, Mutex, MutexGuard};

use crate::apps::{App, AppOp, Launch};
use crate::ax::{AxAction, Element, ElementRef, Setting};
use crate::input::{Event, Mouse, plan_chord, plan_mouse, plan_text};
use crate::keys::Chord;
use crate::pace::Bucket;
use crate::{Clock, Computer, Error, ErrorCode, Permit, RateLimit, StopFlag, SystemClock};

mod describe;

/// Something `Control` may do to the computer.
#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    Mouse(Mouse),
    /// Press a chord.
    Key(Chord),
    /// Type text as it is written, in any script.
    Text(String),
    Perform {
        element: ElementRef,
        action: AxAction,
    },
    Set {
        element: ElementRef,
        setting: Setting,
    },
    Launch(Launch),
    App {
        pid: i32,
        op: AppOp,
    },
}

impl Action {
    /// The action in words before it runs, as the guard's card shows it: `click left at (120, 340)`.
    pub fn describe(&self) -> String {
        describe::action(self)
    }
}

/// The guard's answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    Allow,
    /// Refuse, with a reason for people; the action answers `permission_denied`.
    Refuse(String),
}

/// Decides whether an action may run, before anything of it reaches the computer. It may block
/// while it asks the person (the core's approval card, ADR 0078); the action waits, holding no
/// queue. A closure `Fn(&Action) -> Verdict` is a guard.
pub trait Guard: Send + Sync {
    fn check(&self, action: &Action) -> Verdict;
}

impl<F: Fn(&Action) -> Verdict + Send + Sync> Guard for F {
    fn check(&self, action: &Action) -> Verdict {
        self(action)
    }
}

/// What an action did.
#[derive(Debug, Clone, PartialEq)]
pub struct Done {
    pub action: Action,
    /// How many events went out: input events, or 1 for an AX or app action.
    pub events: u32,
    /// What it did, for people and the log: `clicked left at (120, 340)`.
    pub summary: String,
    /// The element an AX action reached.
    pub element: Option<Element>,
    /// The app an app action reached.
    pub app: Option<App>,
}

enum Step {
    Post(Event),
    Perform(ElementRef, AxAction),
    Set(ElementRef, Setting),
    Launch(Launch),
    App(i32, AppOp),
}

/// A `Computer` behind a guard, a stop flag and a rate limit.
pub struct Control {
    computer: Arc<dyn Computer>,
    guard: Arc<dyn Guard>,
    stop: StopFlag,
    clock: Arc<dyn Clock>,
    /// The queue: one action holds it at a time.
    bucket: Mutex<Bucket>,
}

impl Control {
    /// With the default `RateLimit`, the system clock and a stop flag of its own. There is no
    /// default guard: a caller that wants none passes `|_: &Action| Verdict::Allow`.
    pub fn new(computer: Arc<dyn Computer>, guard: impl Guard + 'static) -> Self {
        Self {
            computer,
            guard: Arc::new(guard),
            stop: StopFlag::new(),
            clock: Arc::new(SystemClock::new()),
            bucket: Mutex::new(Bucket::new(RateLimit::default())),
        }
    }

    pub fn with_rate(self, limit: RateLimit) -> Self {
        *self.queue() = Bucket::new(limit);
        self
    }

    pub fn with_clock(mut self, clock: Arc<dyn Clock>) -> Self {
        self.clock = clock;
        self
    }

    /// Share a stop flag (the desk's emergency stop) instead of this control's own.
    pub fn with_stop(mut self, stop: StopFlag) -> Self {
        self.stop = stop;
        self
    }

    /// The computer, for reads: screenshots, windows, trees.
    pub fn computer(&self) -> &Arc<dyn Computer> {
        &self.computer
    }

    /// The flag that stops this control's input; raise it from anywhere.
    pub fn stop_flag(&self) -> StopFlag {
        self.stop.clone()
    }

    pub fn mouse(&self, mouse: Mouse) -> Result<Done, Error> {
        self.act(Action::Mouse(mouse))
    }

    pub fn key(&self, chord: Chord) -> Result<Done, Error> {
        self.act(Action::Key(chord))
    }

    pub fn text(&self, text: impl Into<String>) -> Result<Done, Error> {
        self.act(Action::Text(text.into()))
    }

    /// Run `action`: `invalid_params` if it cannot run, `cancelled` while the stop flag is raised
    /// (before it, or at any event of it), `permission_denied` when the guard refuses, else the
    /// computer's own errors. A failure part-way says how many events went out first.
    pub fn act(&self, action: Action) -> Result<Done, Error> {
        let steps = plan(&action)?;
        let total = steps.len();
        let what = describe::action(&action);
        self.check_stop(&what, 0, total)?;
        if let Verdict::Refuse(reason) = self.guard.check(&action) {
            return Err(Error::new(
                ErrorCode::PermissionDenied,
                format!("{what}: refused: {reason}"),
            ));
        }
        let mut bucket = self.queue();
        let permit = Permit::new();
        let (mut element, mut app) = (None, None);
        let mut held: Vec<Event> = Vec::new();
        for (index, step) in steps.into_iter().enumerate() {
            let result = self.check_stop(&what, index, total).and_then(|()| {
                bucket
                    .take(self.clock.as_ref(), &self.stop)
                    .map_err(|_| stopped(&what, index, total))
            });
            let result = result.and_then(|()| match step {
                Step::Post(event) => {
                    self.computer.post(&event, &permit)?;
                    track(&mut held, event);
                    Ok(())
                }
                Step::Perform(target, ax) => {
                    element = Some(self.computer.perform(&target, ax, &permit)?);
                    Ok(())
                }
                Step::Set(target, setting) => {
                    element = Some(self.computer.set(&target, &setting, &permit)?);
                    Ok(())
                }
                Step::Launch(launch) => {
                    app = Some(self.computer.launch(&launch, &permit)?);
                    Ok(())
                }
                Step::App(pid, op) => {
                    app = Some(self.computer.app(pid, op, &permit)?);
                    Ok(())
                }
            });
            if let Err(error) = result {
                self.release(held, &permit);
                return Err(part_way(error, index, total));
            }
        }
        drop(bucket);
        let summary = describe::done(&action, total, element.as_ref(), app.as_ref());
        Ok(Done {
            action,
            events: total as u32,
            summary,
            element,
            app,
        })
    }

    fn queue(&self) -> MutexGuard<'_, Bucket> {
        self.bucket.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn check_stop(&self, what: &str, index: usize, total: usize) -> Result<(), Error> {
        if self.stop.is_raised() {
            return Err(stopped(what, index, total));
        }
        Ok(())
    }

    /// Release what an aborted action left pressed, newest first, past the stop flag and the rate
    /// limit; a release that fails is skipped.
    fn release(&self, held: Vec<Event>, permit: &Permit) {
        for press in held.iter().rev() {
            if let Some(release) = press.release() {
                let _ = self.computer.post(&release, permit);
            }
        }
    }
}

/// Keep the presses still held after `event`.
fn track(held: &mut Vec<Event>, event: Event) {
    if let Some(index) = held.iter().rposition(|press| event.releases(press)) {
        held.remove(index);
    } else if event.release().is_some() {
        held.push(event);
    }
}

fn plan(action: &Action) -> Result<Vec<Step>, Error> {
    let posts = |events: Vec<Event>| events.into_iter().map(Step::Post).collect();
    Ok(match action {
        Action::Mouse(mouse) => posts(plan_mouse(mouse)?),
        Action::Key(chord) => posts(plan_chord(chord)),
        Action::Text(text) => posts(plan_text(text)?),
        Action::Perform { element, action } => vec![Step::Perform(element.clone(), *action)],
        Action::Set { element, setting } => vec![Step::Set(element.clone(), setting.clone())],
        Action::Launch(launch) => {
            launch.check()?;
            vec![Step::Launch(launch.clone())]
        }
        Action::App { pid, op } => vec![Step::App(*pid, *op)],
    })
}

fn stopped(what: &str, index: usize, total: usize) -> Error {
    let message = if index == 0 {
        format!("{what}: stopped before it started")
    } else {
        format!("{what}: stopped after {index} of {total} events")
    };
    Error::new(ErrorCode::Cancelled, message)
}

fn part_way(error: Error, index: usize, total: usize) -> Error {
    if index == 0 || error.code == ErrorCode::Cancelled {
        return error;
    }
    Error::new(
        error.code,
        format!("after {index} of {total} events: {}", error.message),
    )
}
