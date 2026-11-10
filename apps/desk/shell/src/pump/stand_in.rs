//! The frame clock's stand-in while CEF's work runs long (#129). The event loop looks at the clock
//! between work calls (`compositor_window/clock.rs`, the probe's loop), so a call that busy-waits
//! out CEF's 10 ms slice (`pump.rs`) would hold every begin frame due meanwhile: a press's prompt
//! frames, an animation's next. When a call starts while the clock runs at the desk's rate or
//! faster and looks within the slice, this thread wakes for that look; if the call still runs then
//! (and has run `GRACE`), it looks itself, and again at each look the clock wants until the call
//! ends. Its begin frames go to CEF from this thread, and CEF posts them to its UI thread, where
//! the busy-wait runs them at once. A slow clock's begin frames (every surface long idle) wait for
//! the call to end: nothing is in a hurry then, and the thread stays asleep.

use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// The frame clock's look at a moment: the begin frames due go out; when it wants its next look.
pub type Look = Arc<dyn Fn(Instant) -> Option<Instant> + Send + Sync>;
/// Whether the clock wants a look at once (input whose paint should follow, not looked at yet).
pub type Soon = Arc<dyn Fn() -> bool + Send + Sync>;

/// How long a call runs before the stand-in looks: most take a fraction of it, and the event loop
/// looks itself right after.
const GRACE: Duration = Duration::from_millis(1);
/// CEF's time slice: a call runs no longer than this unless one of its tasks does.
const SLICE: Duration = Duration::from_millis(10);
/// A clock whose next look is this close runs at the desk's rate or faster (a prompt, a frame).
const FAST: Duration = Duration::from_micros(16_700);
/// The least time between two of the stand-in's looks.
const SPACING: Duration = Duration::from_micros(200);

#[derive(Default)]
struct State {
    look: Option<Look>,
    soon: Option<Soon>,
    /// The clock's next look as the event loop last told it, and whether that runs fast.
    next: Option<Instant>,
    fast: bool,
    /// A work call runs, its number, and when the stand-in looks in it (`None`: it does not).
    working: bool,
    call: u64,
    at: Option<Instant>,
    /// The stand-in is looking now: the event loop waits for it before it looks again.
    looking: bool,
}

/// The stand-in's state, shared with its thread.
#[derive(Clone, Default)]
pub struct StandIn(Arc<(Mutex<State>, Condvar)>);

impl StandIn {
    fn state(&self) -> MutexGuard<'_, State> {
        self.0.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The clock's look, and whether it wants one at once; the first starts the stand-in's thread.
    pub fn set(&self, look: Look, soon: Soon) {
        let first = {
            let mut state = self.state();
            state.soon = Some(soon);
            state.look.replace(look).is_none()
        };
        if first {
            let shared = self.clone();
            let spawned = std::thread::Builder::new()
                .name("desk-clock-stand-in".to_owned())
                .spawn(move || shared.run());
            if let Err(why) = spawned {
                eprintln!("endue Desk: no stand-in for the frame clock ({why})");
            }
        }
    }

    /// The event loop looked at `now`; the clock looks next at `next`.
    pub fn looked(&self, now: Instant, next: Option<Instant>) {
        let mut state = self.state();
        state.next = next;
        state.fast = next.is_some_and(|next| next <= now + FAST);
    }

    /// A work call starts at `now`: if the clock wants a look at once, or a fast clock looks within
    /// the call's slice, the stand-in wakes then.
    pub fn enter(&self, now: Instant) {
        let mut state = self.state();
        let soon = state
            .soon
            .as_ref()
            .is_some_and(|soon| soon())
            .then_some(now);
        let fast = state.next.filter(|next| state.fast && *next < now + SLICE);
        let at = soon
            .or(fast)
            .filter(|_| state.look.is_some())
            .map(|next| next.max(now + GRACE));
        state.working = true;
        state.call += 1;
        state.at = at;
        if at.is_some() {
            self.0.1.notify_one();
        }
    }

    /// The call ended. If the stand-in is looking, wait for it: the event loop looks next.
    pub fn leave(&self) {
        let mut state = self.state();
        state.working = false;
        state.at = None;
        while state.looking {
            state = self.0.1.wait(state).unwrap_or_else(|e| e.into_inner());
        }
    }

    /// The stand-in's thread: asleep until a call it should look in, then at each look it wants.
    fn run(&self) {
        let (lock, wake) = &*self.0;
        let mut state = self.state();
        loop {
            let Some(at) = state.at.filter(|_| state.working) else {
                state = wake.wait(state).unwrap_or_else(|e| e.into_inner());
                continue;
            };
            let now = Instant::now();
            if now < at {
                state = wake
                    .wait_timeout(state, at - now)
                    .unwrap_or_else(|e| e.into_inner())
                    .0;
                continue;
            }
            let (call, look) = (state.call, state.look.clone());
            state.looking = true;
            drop(state);
            let next = look.and_then(|look| look(now));
            state = lock.lock().unwrap_or_else(|e| e.into_inner());
            state.looking = false;
            wake.notify_all();
            if state.working && state.call == call {
                state.next = next;
                state.at = next.map(|next| next.max(now + SPACING));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{GRACE, Look, StandIn};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::time::{Duration, Instant};

    fn counting(soon: Arc<AtomicBool>) -> (StandIn, Arc<AtomicU32>) {
        let looks = Arc::new(AtomicU32::new(0));
        let counter = Arc::clone(&looks);
        let look: Look = Arc::new(move |now| {
            counter.fetch_add(1, Ordering::SeqCst);
            Some(now + Duration::from_millis(1))
        });
        let stand_in = StandIn::default();
        stand_in.set(look, Arc::new(move || soon.load(Ordering::SeqCst)));
        (stand_in, looks)
    }

    /// When the stand-in would look in the call that starts at `now`.
    fn armed(stand_in: &StandIn, now: Instant) -> Option<Instant> {
        stand_in.enter(now);
        let at = stand_in.state().at;
        stand_in.leave();
        at
    }

    #[test]
    fn a_long_call_gets_the_fast_clocks_looks_from_the_stand_in_and_none_once_it_ended() {
        let (stand_in, looks) = counting(Arc::default());
        let now = Instant::now();
        stand_in.looked(now, Some(now + Duration::from_millis(1)));
        stand_in.enter(Instant::now());
        std::thread::sleep(Duration::from_millis(10));
        stand_in.leave();
        let seen = looks.load(Ordering::SeqCst);
        assert!(seen >= 1, "the stand-in looked while the call ran");
        std::thread::sleep(Duration::from_millis(5));
        assert_eq!(looks.load(Ordering::SeqCst), seen, "none once it ended");
    }

    #[test]
    fn it_wakes_for_a_fast_clocks_look_within_the_slice_or_a_press_never_for_a_slow_clock() {
        let soon = Arc::new(AtomicBool::new(false));
        let (stand_in, _) = counting(Arc::clone(&soon));
        let now = Instant::now();
        stand_in.looked(now, Some(now + Duration::from_millis(4)));
        let start = now + Duration::from_millis(1);
        assert_eq!(
            armed(&stand_in, start),
            Some(now + Duration::from_millis(4)),
            "the desk frame's look"
        );
        stand_in.looked(now, Some(now));
        assert_eq!(
            armed(&stand_in, start),
            Some(start + GRACE),
            "not before the call has run its grace"
        );
        stand_in.looked(now, Some(now + Duration::from_millis(16)));
        assert_eq!(armed(&stand_in, now), None, "a look after the slice");
        stand_in.looked(now, Some(now + Duration::from_millis(100)));
        assert_eq!(
            armed(&stand_in, now),
            None,
            "a slow clock waits for the call"
        );
        soon.store(true, Ordering::SeqCst);
        assert_eq!(
            armed(&stand_in, now),
            Some(now + GRACE),
            "a press not looked at yet, whatever the clock"
        );
    }
}
