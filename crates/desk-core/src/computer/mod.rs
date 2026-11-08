//! The core's seat at the computer (ADR 0123): the desk-computer driver the app injects, behind one
//! `Control` whose guard lets an act through only from inside the core's checks, the desk's one stop
//! flag, and where the screenshots of agents' acts are kept. `act` is the pipeline every act takes,
//! `read` the see methods, `runs` the record on the runs board and the activity events, `map` the
//! bridge's shapes.

mod act;
pub(crate) mod map;
mod read;
mod runs;

use std::cell::RefCell;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use desk_bridge::{BridgeError, ErrorCode};
use desk_computer::apps::App;
use desk_computer::screen::WindowScope;
use desk_computer::{Action, Computer, Control, Done, Guard, Point, StopFlag, Verdict};

pub(crate) use act::{Act, Reach};

use crate::handler::{error, sys_error};

thread_local! {
    /// The act the core cleared on this thread, which the guard lets through once.
    static CLEARED: RefCell<Option<Action>> = const { RefCell::new(None) };
}

/// The guard of the core's `Control`: nothing reaches the computer around the core's checks.
struct CoreGuard;

impl Guard for CoreGuard {
    fn check(&self, action: &Action) -> Verdict {
        if CLEARED.with(|cleared| cleared.borrow().as_ref() == Some(action)) {
            Verdict::Allow
        } else {
            Verdict::Refuse("only the desk's checks let an act through".to_owned())
        }
    }
}

/// The driver, the stop flag and the screenshots' folder.
#[derive(Default)]
pub(crate) struct Seat {
    control: RwLock<Option<Arc<Control>>>,
    shots: RwLock<Option<PathBuf>>,
    stop: StopFlag,
    taken: AtomicU64,
}

impl Seat {
    pub(crate) fn serve(&self, computer: Arc<dyn Computer>) {
        let control = Control::new(computer, CoreGuard).with_stop(self.stop.clone());
        *self.control.write().unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(control));
    }

    pub(crate) fn keep_shots(&self, dir: PathBuf) {
        *self.shots.write().unwrap_or_else(|e| e.into_inner()) = Some(dir);
    }

    /// The control, or `unsupported` when the desk has no driver.
    pub(crate) fn control(&self) -> Result<Arc<Control>, BridgeError> {
        let control = self.control.read().unwrap_or_else(|e| e.into_inner());
        control.clone().ok_or_else(|| {
            let none = "computer use is not available on this desk: it has no driver";
            error(ErrorCode::Unsupported, none.to_owned())
        })
    }

    /// The driver, for reads.
    pub(crate) fn computer(&self) -> Result<Arc<dyn Computer>, BridgeError> {
        Ok(Arc::clone(self.control()?.computer()))
    }

    pub(crate) fn shots(&self) -> Option<PathBuf> {
        self.shots.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// A number for the next screenshot's file, unique in this session.
    pub(crate) fn next_shot(&self) -> u64 {
        self.taken.fetch_add(1, Ordering::Relaxed) + 1
    }

    pub(crate) fn stop_flag(&self) -> &StopFlag {
        &self.stop
    }
}

/// Run `action` through `control`, cleared by the core: the guard lets exactly this one through.
pub(crate) fn run(control: &Control, action: Action) -> Result<Done, BridgeError> {
    CLEARED.with(|cleared| *cleared.borrow_mut() = Some(action.clone()));
    let done = control.act(action);
    CLEARED.with(|cleared| cleared.borrow_mut().take());
    done.map_err(sys_error)
}

/// The frontmost app: the first active one.
pub(crate) fn frontmost(computer: &dyn Computer) -> Result<Option<App>, BridgeError> {
    let apps = computer.apps().map_err(sys_error)?;
    Ok(apps.into_iter().find(|app| app.active))
}

/// The running app with `pid`.
pub(crate) fn app_of(computer: &dyn Computer, pid: i32) -> Result<Option<App>, BridgeError> {
    let apps = computer.apps().map_err(sys_error)?;
    Ok(apps.into_iter().find(|app| app.pid == pid))
}

/// The app whose window is frontmost under `point`, if any window is there.
pub(crate) fn app_at(computer: &dyn Computer, point: Point) -> Result<Option<App>, BridgeError> {
    let windows = computer.windows(WindowScope::OnScreen).map_err(sys_error)?;
    let Some(window) = windows
        .into_iter()
        .find(|w| w.alpha > 0.0 && w.bounds.contains(point))
    else {
        return Ok(None);
    };
    let running = app_of(computer, window.pid)?;
    Ok(Some(running.unwrap_or(App {
        pid: window.pid,
        name: window.app,
        bundle_id: window.bundle_id,
        path: None,
        active: false,
        hidden: false,
        regular: true,
    })))
}

/// How a card and the log name the app an act reaches: `Safari (com.apple.Safari)`.
pub(crate) fn label(app: Option<&App>) -> String {
    match app {
        Some(App {
            name,
            bundle_id: Some(id),
            ..
        }) => format!("{name} ({id})"),
        Some(app) => app.name.clone(),
        None => "the screen".to_owned(),
    }
}
