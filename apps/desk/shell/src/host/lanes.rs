//! Lanes of work: the jobs of one lane run one after another in the order they came, each lane on
//! threads of its own, so lanes run side by side and none waits for another. The bridge (`host.rs`)
//! gives each page one lane to read its calls in and each caller one lane to answer them in, so the
//! calls of a caller are applied in the order its page sent them.
//!
//! In a lane that lets go (`Lanes::letting_go`) each job runs on a thread of its own and the next one
//! starts when it ends or once it has run for the lane's hold: a call that waits (for the person's
//! answer, a dialog, the network, a call the same page sends after it) holds the rest up that long
//! and no longer, so no call waits for a later one for good. A strict lane (`Lanes::strict`) runs each
//! job to its end on the lane's thread, for work that never waits. Queueing a job never waits.

use std::collections::{HashMap, VecDeque};
use std::hash::Hash;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

type Job = Box<dyn FnOnce() + Send + 'static>;

/// Jobs by lane, each lane run in order.
pub struct Lanes<K> {
    shared: Arc<Shared<K>>,
}

struct Shared<K> {
    /// The lanes with work, each with the jobs still to start; a lane is here while its thread runs.
    queues: Mutex<HashMap<K, VecDeque<Job>>>,
    /// How long a job holds the next one up; none: until it ends.
    hold: Option<Duration>,
    /// The threads' name.
    name: &'static str,
}

impl<K: Eq + Hash + Clone + Send + 'static> Lanes<K> {
    /// Lanes whose jobs run to their end one after another, on the lane's thread.
    pub fn strict(name: &'static str) -> Self {
        Self::with(name, None)
    }

    /// Lanes whose jobs run on threads of their own, each starting once the one before it ended or
    /// has run for `hold`.
    pub fn letting_go(name: &'static str, hold: Duration) -> Self {
        Self::with(name, Some(hold))
    }

    fn with(name: &'static str, hold: Option<Duration>) -> Self {
        let queues = Mutex::new(HashMap::new());
        Self {
            shared: Arc::new(Shared { queues, hold, name }),
        }
    }

    /// Run `job` in lane `key` after the jobs that came before it there. Never waits.
    pub fn run(&self, key: K, job: impl FnOnce() + Send + 'static) {
        let mut queues = self.shared.lock();
        if let Some(queue) = queues.get_mut(&key) {
            queue.push_back(Box::new(job));
            return;
        }
        queues.insert(key.clone(), VecDeque::from([Box::new(job) as Job]));
        drop(queues);
        let shared = Arc::clone(&self.shared);
        let lane = key.clone();
        let spawned = thread::Builder::new()
            .name(self.shared.name.to_owned())
            .spawn(move || shared.drive(&lane));
        if let Err(why) = spawned {
            let dropped = self.shared.lock().remove(&key).map_or(0, |q| q.len());
            eprintln!(
                "endue Desk: no thread for a lane of {} ({why}); {dropped} dropped",
                self.shared.name
            );
        }
    }

    /// The lanes with work still to start or running.
    #[cfg(test)]
    pub fn busy(&self) -> usize {
        self.shared.lock().len()
    }
}

impl<K: Eq + Hash> Shared<K> {
    fn lock(&self) -> MutexGuard<'_, HashMap<K, VecDeque<Job>>> {
        self.queues.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Start lane `key`'s jobs in order until it has none; then the lane is gone.
    fn drive(&self, key: &K) {
        loop {
            let job = {
                let mut queues = self.lock();
                match queues.get_mut(key).and_then(VecDeque::pop_front) {
                    Some(job) => job,
                    None => {
                        queues.remove(key);
                        return;
                    }
                }
            };
            match self.hold {
                // A panic ends the job, not the lane.
                None => drop(catch_unwind(AssertUnwindSafe(job))),
                Some(hold) => self.run_held(job, hold),
            }
        }
    }

    /// Run `job` on a thread of its own; return when it ends or has run for `hold`.
    fn run_held(&self, job: Job, hold: Duration) {
        let (running, watched) = mpsc::channel::<()>();
        let spawned = thread::Builder::new()
            .name(self.name.to_owned())
            .spawn(move || {
                // Started; dropped when the job ends, or with its panic.
                let _ = running.send(());
                job();
                drop(running);
            });
        match spawned {
            Ok(_) => {
                if watched.recv().is_ok() {
                    let _ = watched.recv_timeout(hold);
                }
            }
            Err(why) => eprintln!("endue Desk: no thread for a job of {} ({why})", self.name),
        }
    }
}

#[cfg(test)]
#[path = "lanes_tests.rs"]
mod tests;
