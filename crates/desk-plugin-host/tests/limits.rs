//! Every instance has a memory limit and an epoch-based time limit.

mod common;

use std::time::{Duration, Instant};

use common::{MockHost, PluginDir, component};
use desk_plugin_host::{Limits, LogicHost, PluginError};
use serde_json::json;

#[test]
fn a_guest_that_runs_too_long_hits_the_time_limit() {
    let spin = component("(loop $forever (br $forever))", "");
    let dir = PluginDir::logic("test.spin", json!([]), &spin);
    let limits = Limits {
        time: Duration::from_millis(200),
        ..Limits::default()
    };
    let mut logic = LogicHost::new(MockHost::new(), limits).unwrap();
    let id = logic.install(&dir.path).unwrap();

    let started = Instant::now();
    let result = logic.start(&id);
    assert!(matches!(result, Err(PluginError::TimeLimit)), "{result:?}");
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "{:?}",
        started.elapsed()
    );
}

#[test]
fn a_guest_that_grows_past_the_memory_limit_is_stopped() {
    // 1000 pages of 64 KiB is about 62 MiB, past a 16 MiB limit.
    let hog = component("(drop (memory.grow (i32.const 1000)))", "");
    let dir = PluginDir::logic("test.hog", json!([]), &hog);
    let limits = Limits {
        memory_bytes: 16 << 20,
        ..Limits::default()
    };
    let mut logic = LogicHost::new(MockHost::new(), limits).unwrap();
    let id = logic.install(&dir.path).unwrap();

    let result = logic.start(&id);
    assert!(
        matches!(result, Err(PluginError::MemoryLimit)),
        "{result:?}"
    );
}
