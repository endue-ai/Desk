//! One instance trapping never affects another, and a reload builds a new instance from new bytes.

mod common;

use common::{MockHost, PluginDir, component, failing, fine};
use desk_plugin_host::{Error, ErrorCode, Limits, LogicHost, PluginError};
use serde_json::json;

#[test]
fn one_instance_trapping_never_affects_another() {
    let broken = PluginDir::logic("test.broken", json!([]), &component("(unreachable)", ""));
    let steady = PluginDir::logic("test.steady", json!([]), &fine());
    let mut logic = LogicHost::new(MockHost::new(), Limits::default()).unwrap();
    let broken = logic.install(&broken.path).unwrap();
    let steady = logic.install(&steady.path).unwrap();

    let result = logic.start(&broken);
    assert!(matches!(result, Err(PluginError::Trap(_))), "{result:?}");
    logic.start(&steady).unwrap();

    // The trapped instance stays down until it is reloaded; its neighbour keeps running.
    let again = logic.start(&broken);
    assert!(matches!(again, Err(PluginError::Crashed(_))), "{again:?}");
    logic.start(&steady).unwrap();
    assert_eq!(logic.installed(), ["test.broken", "test.steady"]);
}

#[test]
fn a_reload_builds_a_new_instance_from_new_bytes() {
    let dir = PluginDir::logic("test.reload", json!([]), &failing("v1"));
    let mut logic = LogicHost::new(MockHost::new(), Limits::default()).unwrap();
    let id = logic.install(&dir.path).unwrap();
    let first = logic.start(&id);
    let expected = Error {
        code: ErrorCode::Internal,
        message: "v1".into(),
    };
    assert!(
        matches!(&first, Err(PluginError::Guest(e)) if *e == expected),
        "{first:?}"
    );

    dir.write("plugin.wasm", &fine());
    logic.reload(&id).unwrap();
    logic.start(&id).unwrap();
}
