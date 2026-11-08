//! A computer in memory, for tests here and in the crates above. It records every call in order
//! (with the time on its clock, when it has one), answers scripted displays, windows, screenshots,
//! accessibility trees and apps, and follows the OS's rules: AX calls and input need
//! Accessibility, screenshots need Screen Recording, window titles are hidden without it. `set`
//! changes its trees, so a later read shows the new value.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use crate::apps::{App, AppOp, Launch};
use crate::ax::{AxAction, Budget, ElementRef, Node, Query, Setting};
use crate::input::Event;
use crate::permissions::Permission;
use crate::screen::{Capture, Display, Screenshot, Target, Window, WindowScope};
use crate::{Clock, Point, Rect};

mod computer;

/// One call a `FakeComputer` received.
#[derive(Debug, Clone, PartialEq)]
pub enum Call {
    Permissions,
    Request(Permission),
    OpenSettings(Permission),
    Displays,
    Windows(WindowScope),
    Screenshot(Capture),
    Focused,
    Tree(ElementRef, Budget),
    Find(ElementRef, Query, Budget),
    Apps,
    Post(Event),
    Perform(ElementRef, AxAction),
    Set(ElementRef, Setting),
    Launch(Launch),
    App(i32, AppOp),
}

impl Call {
    /// Whether it acts on the computer (what only `Control` may call).
    pub fn is_act(&self) -> bool {
        matches!(
            self,
            Call::Post(_) | Call::Perform(..) | Call::Set(..) | Call::Launch(_) | Call::App(..)
        )
    }
}

/// What the fake answers, and what it was asked.
#[derive(Default)]
struct State {
    accessibility: bool,
    screen_recording: bool,
    /// What `request` turns a missing permission into.
    answer: bool,
    displays: Vec<Display>,
    windows: Vec<Window>,
    shots: Vec<(Target, Screenshot)>,
    trees: BTreeMap<i32, Node>,
    apps: Vec<App>,
    installed: Vec<App>,
    /// The focused window and element of the active app, by path.
    focus: (Option<Vec<u32>>, Option<Vec<u32>>),
    pointer: Point,
    next_pid: i32,
    calls: Vec<(Duration, Call)>,
}

/// A `Computer` in memory. Starts with both permissions granted, `request` granting what is asked,
/// one 1440 × 900 Retina main display and nothing else.
pub struct FakeComputer {
    state: Mutex<State>,
    clock: Option<Arc<dyn Clock>>,
}

impl FakeComputer {
    pub fn new() -> Self {
        let display = Display {
            id: 1,
            bounds: Rect::new(0.0, 0.0, 1440.0, 900.0),
            scale: 2.0,
            main: true,
            builtin: true,
        };
        Self {
            state: Mutex::new(State {
                accessibility: true,
                screen_recording: true,
                answer: true,
                displays: vec![display],
                next_pid: 10_000,
                ..State::default()
            }),
            clock: None,
        }
    }

    pub fn with_permissions(self, accessibility: bool, screen_recording: bool) -> Self {
        {
            let mut state = self.state();
            state.accessibility = accessibility;
            state.screen_recording = screen_recording;
        }
        self
    }

    /// Whether `request` grants a missing permission (the person says yes).
    pub fn with_answer(self, grant: bool) -> Self {
        self.state().answer = grant;
        self
    }

    pub fn with_displays(self, displays: Vec<Display>) -> Self {
        self.state().displays = displays;
        self
    }

    /// Front to back.
    pub fn with_windows(self, windows: Vec<Window>) -> Self {
        self.state().windows = windows;
        self
    }

    /// What a capture of `target` shows, whatever its bounds; an unscripted target is `not_found`.
    pub fn with_screenshot(self, target: Target, shot: Screenshot) -> Self {
        self.state().shots.push((target, shot));
        self
    }

    /// The accessibility tree of `pid`, its application element at the root; paths index into it.
    pub fn with_tree(self, pid: i32, root: Node) -> Self {
        self.state().trees.insert(pid, root);
        self
    }

    /// The running apps; the first active one is frontmost.
    pub fn with_apps(self, apps: Vec<App>) -> Self {
        self.state().apps = apps;
        self
    }

    /// Apps `launch` can start, found by bundle id or path; they get a new pid.
    pub fn with_installed(self, apps: Vec<App>) -> Self {
        self.state().installed = apps;
        self
    }

    /// The frontmost app's focused window and element, by path in its tree.
    pub fn with_focus(self, window: Option<Vec<u32>>, element: Option<Vec<u32>>) -> Self {
        self.state().focus = (window, element);
        self
    }

    /// Stamp every call with this clock's time (see `timeline`).
    pub fn with_clock(mut self, clock: Arc<dyn Clock>) -> Self {
        self.clock = Some(clock);
        self
    }

    /// Every call, in order.
    pub fn calls(&self) -> Vec<Call> {
        self.state().calls.iter().map(|(_, c)| c.clone()).collect()
    }

    /// Every call with the time it came, on the clock given to `with_clock` (zero without one).
    pub fn timeline(&self) -> Vec<(Duration, Call)> {
        self.state().calls.clone()
    }

    /// The acting calls only, in order.
    pub fn acts(&self) -> Vec<Call> {
        self.calls().into_iter().filter(Call::is_act).collect()
    }

    /// The input events posted, in order.
    pub fn posted(&self) -> Vec<Event> {
        self.calls()
            .into_iter()
            .filter_map(|call| match call {
                Call::Post(event) => Some(event),
                _ => None,
            })
            .collect()
    }

    /// The text typed so far: `Event::Text` chunks, with `\n` for Return and `\t` for Tab presses.
    pub fn typed(&self) -> String {
        let mut typed = String::new();
        for event in self.posted() {
            match event {
                Event::Text { text } => typed.push_str(&text),
                Event::KeyDown { key, modifiers } if modifiers.is_empty() => match key {
                    crate::keys::Key::Return => typed.push('\n'),
                    crate::keys::Key::Tab => typed.push('\t'),
                    _ => {}
                },
                _ => {}
            }
        }
        typed
    }

    /// The tree of `pid` as it is now.
    pub fn tree_of(&self, pid: i32) -> Option<Node> {
        self.state().trees.get(&pid).cloned()
    }

    /// The running apps as they are now.
    pub fn running(&self) -> Vec<App> {
        self.state().apps.clone()
    }

    /// Where the pointer is after the posted events.
    pub fn pointer(&self) -> Point {
        self.state().pointer
    }

    fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Record `call` and hand the state to the answer.
    fn record(&self, call: Call) -> MutexGuard<'_, State> {
        let at = self.clock.as_ref().map(|c| c.now()).unwrap_or_default();
        let mut state = self.state();
        state.calls.push((at, call));
        state
    }
}

impl Default for FakeComputer {
    fn default() -> Self {
        Self::new()
    }
}

/// A clock that moves only when slept on or advanced, for rate-limit tests.
#[derive(Debug, Default)]
pub struct FakeClock {
    now: Mutex<Duration>,
    slept: Mutex<Vec<Duration>>,
}

impl FakeClock {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn advance(&self, by: Duration) {
        *self.now.lock().unwrap_or_else(|e| e.into_inner()) += by;
    }

    /// Every sleep asked of it, in order.
    pub fn sleeps(&self) -> Vec<Duration> {
        self.slept.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}

impl Clock for FakeClock {
    fn now(&self) -> Duration {
        *self.now.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn sleep(&self, duration: Duration) {
        self.slept
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(duration);
        self.advance(duration);
    }
}
