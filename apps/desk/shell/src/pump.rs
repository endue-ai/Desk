//! When CEF's message loop work runs (#41, #129). With an external message pump CEF asks for
//! `do_message_loop_work` through `OnScheduleMessagePumpWork` (from any thread), and the PoC found
//! that calling it at other times blocked ~60 ms a call on macOS (spikes/compositor, finding 1): the
//! desk calls it when CEF asks, and otherwise only as a poll on a wake-up it has anyway. CEF asks
//! only for work due now; a task Chromium delays from inside its work (a timer, a deadline) is never
//! announced, which is why cefclient polls every `MAX_DELAY` (`kMaxTimerDelay`). The poll rides the
//! desk's own next wake-up (the frame clock's next look, a frame to draw) when that is further away,
//! at most `REST_DELAY` after the last work: a desk at rest sleeps until CEF asks or its clock looks,
//! ten times a second, where the poll woke it thirty times a second whatever the clock did.
//!
//! CEF 156's pump (`MessagePumpExternal::Run`) runs its work in a 10 ms slice: once nothing is due
//! now it calls `DoIdleWork`, which quits the `RunUntilIdle` loop of `CefDoMessageLoopWork`, and the
//! pump ignores the quit until its slice ends. A call that goes idle while a delayed task is due
//! within its slice busy-waits there, running what comes due (#129's traces: thousands of
//! `DoIdleWork` a call, a few calls in a hundred). Nothing outside CEF says when that is, so while a
//! call runs long the frame clock's begin frames go out from a thread of their own
//! (`pump/stand_in.rs`): CEF posts them to its UI thread, where the busy-wait runs them at once.
//!
//! The schedule wakes winit's event loop, which runs the work when it is due and sleeps until then
//! (cefclient's `MainMessageLoopExternalPump`). Without an event loop (the surface probe) it unparks
//! the thread that waits for the work instead.

mod stand_in;

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use desk_web::sender::Role;
use winit::event_loop::{ActiveEventLoop, EventLoopProxy};

use crate::window::Shell;
use stand_in::StandIn;
pub use stand_in::{Look, Soon};

/// The longest wait for the poll while the desk wakes often, as cefclient's `kMaxTimerDelay`.
pub const MAX_DELAY: Duration = Duration::from_millis(1000 / 30);
/// The longest wait for the poll at rest: the slow clock's period (`web_host/frames.rs`).
pub const REST_DELAY: Duration = Duration::from_millis(100);
/// A work call this long kept the event loop from anything else for half CEF's 10 ms slice.
pub const LONG_WORK: Duration = Duration::from_millis(5);
/// The longest wait CEF asks for that is kept as asked (a day, as Chromium caps its own).
const LONGEST_ASK: Duration = Duration::from_secs(86_400);

/// Work for the event loop's thread, from any other: window calls, the shell's services.
pub type Job = Box<dyn FnOnce(&mut Shell, &ActiveEventLoop) + Send>;

/// What wakes the shell's event loop besides the OS.
pub enum Wake {
    /// CEF asked for message loop work.
    Pump,
    /// The browser of a window agreed to close (`DoClose`): its window goes, and the browser with it.
    Closing(Role),
    /// The browser of a window closed.
    Closed(Role),
    /// Run this on the event loop's thread.
    Run(Job),
}

/// When the work is due: when CEF asked for it, and the poll.
#[derive(Clone, Copy, Debug)]
struct Schedule {
    /// When CEF wants its work (`None`: it has asked nothing since the last call).
    asked: Option<Instant>,
    /// When the last call ran.
    last: Instant,
    /// When the poll is due: `MAX_DELAY` after the last call, later where `wake_at` rides it.
    poll: Instant,
}

impl Schedule {
    fn due(&self) -> Instant {
        self.asked.map_or(self.poll, |asked| asked.min(self.poll))
    }
}

/// What the event loop did so far: its turns (each a wake-up), CEF's work calls among them, the
/// time those took, how many took `LONG_WORK` or more and when the last of those ended (the
/// surface probe reads them, #129).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    pub turns: u64,
    pub works: u64,
    pub work: Duration,
    pub long: u64,
    pub long_end: Option<Instant>,
}

/// The pump schedule, shared between CEF's threads and the event loop.
#[derive(Clone)]
pub struct Pump {
    schedule: Arc<Mutex<Schedule>>,
    proxy: Arc<Mutex<Option<EventLoopProxy<Wake>>>>,
    parked: Arc<Mutex<Option<std::thread::Thread>>>,
    counts: Arc<Mutex<Counts>>,
    stand_in: StandIn,
}

impl Pump {
    pub fn new(proxy: Option<EventLoopProxy<Wake>>) -> Self {
        let now = Instant::now();
        Self {
            // The first call runs at once.
            schedule: Arc::new(Mutex::new(Schedule {
                asked: Some(now),
                last: now,
                poll: now + MAX_DELAY,
            })),
            proxy: Arc::new(Mutex::new(proxy)),
            parked: Arc::default(),
            counts: Arc::default(),
            stand_in: StandIn::default(),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Schedule> {
        self.schedule.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Without an event loop: every wake unparks `thread`, which waits with `park_timeout`.
    pub fn wake_thread(&self, thread: std::thread::Thread) {
        *self.parked.lock().unwrap_or_else(|e| e.into_inner()) = Some(thread);
    }

    /// CEF wants work in `delay_ms` (at once when zero or negative).
    pub fn schedule(&self, delay_ms: i64) {
        let delay = Duration::from_millis(delay_ms.max(0).unsigned_abs()).min(LONGEST_ASK);
        let at = Instant::now() + delay;
        {
            let mut schedule = self.lock();
            schedule.asked = Some(schedule.asked.map_or(at, |asked| asked.min(at)));
        }
        self.wake(Wake::Pump);
    }

    /// Wake the event loop with `what`.
    pub fn wake(&self, what: Wake) {
        if let Some(proxy) = self
            .proxy
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            let _ = proxy.send_event(what);
        }
        if let Some(thread) = self
            .parked
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            thread.unpark();
        }
    }

    /// Run `job` on the event loop's thread, soon.
    pub fn run(&self, job: impl FnOnce(&mut Shell, &ActiveEventLoop) + Send + 'static) {
        self.wake(Wake::Run(Box::new(job)));
    }

    /// The frame clock's look, which the stand-in also calls from its own thread while CEF's work
    /// runs long (`pump/stand_in.rs`), and whether the clock wants a look at once. Call once.
    pub fn stand_in(&self, look: Look, soon: Soon) {
        self.stand_in.set(look, soon);
    }

    /// The event loop's own look of the frame clock at `now`: it looks next at `next`.
    pub fn looked(&self, now: Instant, next: Option<Instant>) {
        self.stand_in.looked(now, next);
    }

    /// A turn of the event loop at `now` (CEF's UI thread): CEF's message loop work if it is due.
    /// Whether it ran.
    pub fn turn(&self, now: Instant) -> bool {
        let due = self.take_due(now);
        let mut took = Duration::ZERO;
        if due {
            let started = Instant::now();
            self.stand_in.enter(started);
            cef::do_message_loop_work();
            self.stand_in.leave();
            took = started.elapsed();
        }
        let mut counts = self.counts.lock().unwrap_or_else(|e| e.into_inner());
        counts.turns += 1;
        if due {
            counts.works += 1;
            counts.work += took;
            if took >= LONG_WORK {
                counts.long += 1;
                counts.long_end = Some(Instant::now());
            }
        }
        due
    }

    /// What the event loop did so far.
    pub fn counts(&self) -> Counts {
        *self.counts.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// When the event loop should wake next, given its own next wake-up `desk` (the frame clock's
    /// next look, a frame to draw; `None`: nothing). The poll rides `desk` when that is further
    /// than `MAX_DELAY` from the last call, never further than `REST_DELAY`.
    pub fn wake_at(&self, desk: Option<Instant>) -> Instant {
        let mut schedule = self.lock();
        schedule.poll = rides(schedule.last, desk);
        let due = schedule.due();
        desk.map_or(due, |desk| desk.min(due))
    }

    /// When the next work is due, if no other wake-up comes first.
    pub fn due(&self) -> Instant {
        self.lock().due()
    }

    /// Take the work if it is due at `now`: what CEF asked for is done, the poll is `MAX_DELAY` out.
    pub fn take_due(&self, now: Instant) -> bool {
        let mut schedule = self.lock();
        if now < schedule.due() {
            return false;
        }
        *schedule = Schedule {
            asked: None,
            last: now,
            poll: now + MAX_DELAY,
        };
        true
    }
}

/// When the poll is due after a call at `last`, with the desk next waking at `desk`.
fn rides(last: Instant, desk: Option<Instant>) -> Instant {
    let (soonest, latest) = (last + MAX_DELAY, last + REST_DELAY);
    desk.map_or(latest, |desk| desk.clamp(soonest, latest))
}

#[cfg(test)]
#[path = "pump_tests.rs"]
mod tests;
