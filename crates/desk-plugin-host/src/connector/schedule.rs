//! When and how an instance syncs: the interval and the backoff, rounds until the guest is done,
//! and the scheduler thread that ticks without a caller.

use std::sync::Weak;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use desk_bridge::{ConnectorState, ConnectorStatus, ConnectorSync, ConnectorSyncMode};
use serde_json::Value;

use super::instances::cursor_key;
use super::shared::{crashes, describe, failure, source};
use super::{Installed, Shared, convert};
use crate::clock::rfc3339;

/// Rounds one sync may take; past them it ends `stale` and goes on at the next tick.
const ROUNDS: usize = 100;
/// Between pulls when the manifest does not say, and the least the host waits.
const DEFAULT_INTERVAL: u64 = 900;
const MIN_INTERVAL: u64 = 60;
/// The wait after the first failure, doubled after each one in a row, up to an hour.
const BACKOFF: Duration = Duration::from_secs(30);
const MAX_BACKOFF: Duration = Duration::from_secs(3_600);

/// Between pulls. None when the connector only pushes: no push transport exists yet, so it syncs
/// on demand only.
pub(super) fn interval(sync: &ConnectorSync) -> Option<Duration> {
    if sync.mode == ConnectorSyncMode::Push {
        return None;
    }
    let secs = sync.interval_seconds.unwrap_or(DEFAULT_INTERVAL);
    Some(Duration::from_secs(secs.max(MIN_INTERVAL)))
}

/// The wait after the `failures`-th failure in a row: 30 s, 60 s, 120 s and so on, an hour at most.
pub(super) fn backoff(failures: u32) -> Duration {
    let factor = 2u32
        .checked_pow(failures.saturating_sub(1))
        .unwrap_or(u32::MAX);
    BACKOFF.saturating_mul(factor).min(MAX_BACKOFF)
}

/// How a sync ended short of done.
enum Stop {
    /// This instance failed: the guest's error, an item that does not fit, the sink, the store.
    Failed(String),
    /// The connector trapped or hit a limit; every instance of it is `error` already.
    Crashed,
}

impl Shared {
    /// Sync the instance now: `syncing`, then rounds until the guest says done. Due again an
    /// interval after it started, or after the backoff when it failed. Returns where it ended.
    pub(super) fn sync(&self, id: &str, installed: &mut Installed, name: &str) -> ConnectorStatus {
        let start = self.clock.now();
        let next = interval(&installed.connector.sync).map(|every| start + every);
        if let Some(instance) = installed.instances.get_mut(name) {
            instance.due = next;
        }
        self.set(id, name, installed, ConnectorState::Syncing, None);
        let ended = self.rounds(id, installed, name);
        let Some(instance) = installed.instances.get_mut(name) else {
            return self.set(id, name, installed, ConnectorState::Error, None);
        };
        match ended {
            Ok(true) => {
                instance.failures = 0;
                instance.last_sync_at = Some(rfc3339(self.clock.now()));
                // A refused write leaves the record in memory right; the next write carries it.
                let _ = self.persist(id, installed);
                self.set(id, name, installed, ConnectorState::Connected, None)
            }
            Ok(false) => {
                instance.due = Some(start);
                self.set(id, name, installed, ConnectorState::Stale, None)
            }
            Err(Stop::Failed(message)) => {
                instance.failures += 1;
                instance.due = Some(start + backoff(instance.failures));
                self.set(id, name, installed, ConnectorState::Error, Some(message))
            }
            Err(Stop::Crashed) => instance.status.clone(),
        }
    }

    /// Call `sync` while it is not done, up to `ROUNDS` times. Each round's changes reach the sink
    /// (one upsert, then one remove, each only when there is something) and its cursor the store
    /// before the next round starts. `Ok(false)`: the rounds ran out first.
    fn rounds(&self, id: &str, installed: &mut Installed, name: &str) -> Result<bool, Stop> {
        let (source, key) = (source(id, name), cursor_key(name));
        let stored = self.host.store_get(id, &key);
        let mut cursor = match stored.map_err(|e| Stop::Failed(describe(&e)))? {
            Some(Value::String(cursor)) => Some(cursor),
            _ => None,
        };
        let guest = installed
            .guest(id, name)
            .map_err(|e| Stop::Failed(e.to_string()))?;
        for _ in 0..ROUNDS {
            let called = self.call(id, installed, |c, store| {
                c.call_sync(store, &guest, cursor.as_deref())
            });
            let result = match called {
                Ok(result) => result,
                Err(error) if crashes(&error) => return Err(Stop::Crashed),
                Err(error) => return Err(Stop::Failed(failure(&error))),
            };
            let (done, next) = (result.done, result.cursor.clone());
            let changes = convert::changes(result, &source);
            let (upserted, removed) = changes.map_err(|e| Stop::Failed(describe(&e)))?;
            let refused = |e: String| Stop::Failed(format!("the index refused the changes: {e}"));
            if !upserted.is_empty() {
                self.sink.upsert(&upserted).map_err(refused)?;
            }
            if !removed.is_empty() {
                self.sink.remove(&source, &removed).map_err(refused)?;
            }
            let saved = next.clone().map_or(Value::Null, Value::String);
            let saved = self.host.store_set(id, &key, saved);
            saved.map_err(|e| Stop::Failed(describe(&e)))?;
            cursor = next;
            if done {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

/// The thread that ticks every period until it is dropped, or until its host is gone.
pub(super) struct Scheduler {
    stop: Option<Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

impl Scheduler {
    pub(super) fn start(shared: Weak<Shared>, period: Duration) -> Self {
        let (stop, stopped) = mpsc::channel::<()>();
        let thread = thread::Builder::new()
            .name("desk-connector-scheduler".into())
            .spawn(move || {
                while let Err(RecvTimeoutError::Timeout) = stopped.recv_timeout(period) {
                    let Some(shared) = shared.upgrade() else {
                        break;
                    };
                    shared.tick();
                }
            })
            .expect("the scheduler thread starts");
        Self {
            stop: Some(stop),
            thread: Some(thread),
        }
    }
}

impl Drop for Scheduler {
    fn drop(&mut self) {
        // Dropping the sender wakes the thread at once; joining waits for a tick in progress.
        drop(self.stop.take());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_backoff_doubles_from_30_s_up_to_an_hour() {
        let waits: Vec<u64> = (1..=9).map(|n| backoff(n).as_secs()).collect();
        assert_eq!(waits, [30, 60, 120, 240, 480, 960, 1_920, 3_600, 3_600]);
        assert_eq!(backoff(u32::MAX).as_secs(), 3_600);
    }

    #[test]
    fn the_interval_is_900_s_by_default_60_s_at_least_and_none_for_push() {
        let sync = |mode, interval_seconds| ConnectorSync {
            mode,
            interval_seconds,
        };
        let secs = |s: ConnectorSync| interval(&s).map(|d| d.as_secs());
        assert_eq!(secs(sync(ConnectorSyncMode::Pull, None)), Some(900));
        assert_eq!(secs(sync(ConnectorSyncMode::Both, Some(10))), Some(60));
        assert_eq!(secs(sync(ConnectorSyncMode::Pull, Some(300))), Some(300));
        assert_eq!(secs(sync(ConnectorSyncMode::Push, None)), None);
    }
}
