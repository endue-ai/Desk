//! When CEF's message loop work runs. With an external message pump CEF says when it next needs
//! `do_message_loop_work` (`OnScheduleMessagePumpWork`, from any thread); calling it at any other
//! time blocks ~60 ms per call on macOS (spikes/compositor, finding 1). The schedule wakes winit's
//! event loop, which runs the work when it is due and sleeps until then (cefclient's
//! `MainMessageLoopExternalPump`).

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use desk_web::sender::Role;
use winit::event_loop::{ActiveEventLoop, EventLoopProxy};

use crate::window::Shell;

/// The longest wait between two pump calls, as cefclient's `kMaxTimerDelay`.
pub const MAX_DELAY: Duration = Duration::from_millis(1000 / 30);

/// Work for the event loop's thread, from any other: window calls, the shell's services.
pub type Job = Box<dyn FnOnce(&mut Shell, &ActiveEventLoop) + Send>;

/// What wakes the shell's event loop besides the OS.
pub enum Wake {
    /// CEF asked for message loop work.
    Pump,
    /// The browser of a window closed.
    Closed(Role),
    /// Run this on the event loop's thread.
    Run(Job),
}

/// The pump schedule, shared between CEF's threads and the event loop.
#[derive(Clone)]
pub struct Pump {
    due: Arc<Mutex<Instant>>,
    proxy: Arc<Mutex<Option<EventLoopProxy<Wake>>>>,
}

impl Pump {
    pub fn new(proxy: Option<EventLoopProxy<Wake>>) -> Self {
        Self {
            due: Arc::new(Mutex::new(Instant::now())),
            proxy: Arc::new(Mutex::new(proxy)),
        }
    }

    /// CEF wants work in `delay_ms` (at once when zero or negative); never later than `MAX_DELAY`.
    pub fn schedule(&self, delay_ms: i64) {
        let delay = Duration::from_millis(delay_ms.max(0) as u64).min(MAX_DELAY);
        let at = Instant::now() + delay;
        {
            let mut due = self.due.lock().unwrap_or_else(|e| e.into_inner());
            if at < *due {
                *due = at;
            }
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
    }

    /// Run `job` on the event loop's thread, soon.
    pub fn run(&self, job: impl FnOnce(&mut Shell, &ActiveEventLoop) + Send + 'static) {
        self.wake(Wake::Run(Box::new(job)));
    }

    /// When the next work is due.
    pub fn due(&self) -> Instant {
        *self.due.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Take the work if it is due at `now`, pushing the next due time `MAX_DELAY` out.
    pub fn take_due(&self, now: Instant) -> bool {
        let mut due = self.due.lock().unwrap_or_else(|e| e.into_inner());
        if now < *due {
            return false;
        }
        *due = now + MAX_DELAY;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::{MAX_DELAY, Pump};
    use std::time::{Duration, Instant};

    #[test]
    fn work_is_due_at_once_then_not_before_it_is_scheduled_or_the_maximum_delay() {
        let pump = Pump::new(None);
        let now = Instant::now();
        assert!(pump.take_due(now), "the first call runs at once");
        assert!(!pump.take_due(now + Duration::from_millis(5)));
        assert!(
            pump.take_due(now + MAX_DELAY),
            "never later than the maximum delay"
        );
    }

    #[test]
    fn an_earlier_schedule_wins_and_a_long_one_is_capped() {
        let pump = Pump::new(None);
        let now = Instant::now();
        assert!(pump.take_due(now));
        pump.schedule(0);
        assert!(pump.due() <= Instant::now(), "zero means now");
        assert!(pump.take_due(Instant::now()));
        pump.schedule(60_000);
        assert!(
            pump.due() <= Instant::now() + MAX_DELAY,
            "capped at the maximum delay"
        );
    }
}
