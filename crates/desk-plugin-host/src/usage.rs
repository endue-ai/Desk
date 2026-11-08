//! What each plugin uses: the linear memory its store holds now (counted by the store's `Limiter`),
//! and since install the time its guest ran, its calls into the guest and the guest's imports.

use std::mem;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use wasmtime::Store;

use crate::state::State;

/// What one plugin uses, as the plugin host measures it. `cpu_time`, `calls` and `imports` add up
/// from `install` and survive a reload and a trap, so whoever samples them takes rates from the
/// differences; `remove` drops them, and installing the id again starts them at 0.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Usage {
    /// The linear memory the plugin's store holds now, every memory of its instance together. Wasm
    /// memory never shrinks, so it is also the peak. 0 while the plugin waits for a reload after a
    /// trap or a limit.
    pub memory_bytes: usize,
    /// The time the calling thread spent in the guest's exports, less the time inside its
    /// `desk:host` imports. Instantiation is not counted.
    pub cpu_time: Duration,
    /// Calls into the guest's exports, one that ends in a trap or a limit included.
    pub calls: u64,
    /// The `desk:host` imports the guest called, ones refused for a permission included.
    pub imports: u64,
}

/// The imports a store's guest called since the host last took them, and the time spent in them.
#[derive(Debug, Default)]
pub(crate) struct Imported {
    count: u64,
    time: Duration,
}

impl Imported {
    /// Run one import, and count it with its time.
    pub(crate) fn tally<R>(&mut self, import: impl FnOnce() -> R) -> R {
        let started = clock();
        let answer = import();
        self.time += clock().saturating_sub(started);
        self.count += 1;
        answer
    }
}

/// What one plugin used since install. The host keeps it beside the plugin's store, so it outlives
/// each store: a reload and a trap keep counting.
#[derive(Debug, Default)]
pub(crate) struct Meter {
    cpu_time: Duration,
    calls: u64,
    imports: u64,
}

impl Meter {
    /// Make one call into the guest of `store`, and count it with its imports and its time less
    /// theirs. A call that traps or runs into a limit counts the same.
    pub(crate) fn call<R>(
        &mut self,
        store: &mut Store<State>,
        call: impl FnOnce(&mut Store<State>) -> R,
    ) -> R {
        // Imports made while instantiating count, but their time was not this call's.
        self.imports += mem::take(&mut store.data_mut().imported).count;
        let started = clock();
        let answer = call(store);
        let spent = clock().saturating_sub(started);
        let imported = mem::take(&mut store.data_mut().imported);
        self.calls += 1;
        self.imports += imported.count;
        self.cpu_time += spent.saturating_sub(imported.time);
        answer
    }

    /// The usage so far, with the memory of the plugin's live store, when it has one.
    pub(crate) fn usage(&self, store: Option<&Store<State>>) -> Usage {
        let state = store.map(Store::data);
        Usage {
            memory_bytes: state.map_or(0, |state| state.limiter.held()),
            cpu_time: self.cpu_time,
            calls: self.calls,
            // With the imports made while instantiating, which no call has taken yet.
            imports: self.imports + state.map_or(0, |state| state.imported.count),
        }
    }
}

/// The clock guest time is read from. A guest runs synchronously on the calling thread and blocks
/// only in an import, whose time is taken out, so monotonic time stands in for CPU time and keeps
/// the crate free of platform dependencies. The OS's thread CPU time would replace this one line.
fn clock() -> Duration {
    static ORIGIN: OnceLock<Instant> = OnceLock::new();
    ORIGIN.get_or_init(Instant::now).elapsed()
}
