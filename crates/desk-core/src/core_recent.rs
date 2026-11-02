//! What the core tells an inspector (#334): `cmd.recent`, the last command invocations it saw with
//! their caller, provider and duration, and `plugin.stats`, the bridge calls each caller made over
//! the last minute. Both need `perm:manage`. The registry notes each invocation and its answer
//! (`core_cmd.rs`); `Core::handle` counts every call it answers. Times are the core's clock.

use std::collections::{BTreeMap, VecDeque};
use std::sync::MutexGuard;
use std::time::{SystemTime, UNIX_EPOCH};

use desk_bridge::{
    CallerStats, CmdRecentParams, CmdRecentResult, CommandFailureCode, CommandInvocation,
    Permission, PluginStatsParams, PluginStatsResult,
};
use desk_plugin_host::rfc3339;

use crate::handler::{Answer, Core, json};
use crate::perm::Target;

/// How many invocations cmd.recent keeps.
const KEPT: usize = 200;
/// How far back plugin.stats counts, in seconds.
const WINDOW: u64 = 60;

struct Noted {
    invocation: CommandInvocation,
    started: SystemTime,
}

/// One second of one caller's calls: the second, how many, how many failed.
type Bucket = (u64, u64, u64);

/// The last invocations, oldest first, and each caller's calls by second, oldest first.
#[derive(Default)]
pub(crate) struct Recent {
    invocations: VecDeque<Noted>,
    calls: BTreeMap<String, VecDeque<Bucket>>,
}

impl Recent {
    /// Forget the seconds that left the window.
    fn prune(&mut self, now: u64) {
        for buckets in self.calls.values_mut() {
            while buckets.front().is_some_and(|b| b.0 + WINDOW <= now) {
                buckets.pop_front();
            }
        }
        self.calls.retain(|_, buckets| !buckets.is_empty());
    }
}

impl Core {
    pub(crate) fn cmd_recent(&self, caller: &str, params: CmdRecentParams) -> Answer {
        self.check(caller, &Permission::PermManage(params.scope), &Target::None)?;
        let invocations = self
            .recent()
            .invocations
            .iter()
            .map(|noted| noted.invocation.clone())
            .collect();
        json(CmdRecentResult { invocations })
    }

    pub(crate) fn plugin_stats(&self, caller: &str, params: PluginStatsParams) -> Answer {
        self.check(caller, &Permission::PermManage(params.scope), &Target::None)?;
        let now = seconds(self.clock.now());
        let mut recent = self.recent();
        recent.prune(now);
        let mut callers: Vec<CallerStats> = recent
            .calls
            .iter()
            .map(|(caller, buckets)| CallerStats {
                caller: caller.clone(),
                calls: buckets.iter().map(|b| b.1).sum(),
                failed: buckets.iter().map(|b| b.2).sum(),
            })
            .collect();
        callers.sort_by(|a, b| b.calls.cmp(&a.calls).then_with(|| a.caller.cmp(&b.caller)));
        json(PluginStatsResult {
            window_seconds: WINDOW,
            callers,
        })
    }

    /// A call the core answered, counted for its caller in this second.
    pub(crate) fn count_call(&self, caller: &str, ok: bool) {
        let now = seconds(self.clock.now());
        let mut recent = self.recent();
        recent.prune(now);
        let buckets = recent.calls.entry(caller.to_owned()).or_default();
        let failed = u64::from(!ok);
        match buckets.back_mut() {
            Some(bucket) if bucket.0 == now => {
                bucket.1 += 1;
                bucket.2 += failed;
            }
            _ => buckets.push_back((now, 1, failed)),
        }
    }

    /// cmd.invoke handed `id` to its provider: noted as waiting, the oldest dropped past 200.
    pub(crate) fn note_invoked(&self, invocation_id: &str, id: &str, caller: &str, provider: &str) {
        let started = self.clock.now();
        let mut recent = self.recent();
        if recent.invocations.len() == KEPT {
            recent.invocations.pop_front();
        }
        recent.invocations.push_back(Noted {
            invocation: CommandInvocation {
                invocation_id: invocation_id.to_owned(),
                id: id.to_owned(),
                caller: caller.to_owned(),
                provider: provider.to_owned(),
                at: rfc3339(started),
                duration_ms: None,
                ok: None,
                error: None,
            },
            started,
        });
    }

    /// An invocation was answered, with a result or the failure's code.
    pub(crate) fn note_answered(&self, invocation_id: &str, error: Option<CommandFailureCode>) {
        let now = self.clock.now();
        let mut recent = self.recent();
        let noted = recent
            .invocations
            .iter_mut()
            .rev()
            .find(|noted| noted.invocation.invocation_id == invocation_id);
        if let Some(noted) = noted {
            let took = now.duration_since(noted.started).unwrap_or_default();
            noted.invocation.duration_ms =
                Some(u64::try_from(took.as_millis()).unwrap_or(u64::MAX));
            noted.invocation.ok = Some(error.is_none());
            noted.invocation.error = error;
        }
    }

    fn recent(&self) -> MutexGuard<'_, Recent> {
        self.recent
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Whole seconds since the epoch.
fn seconds(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
