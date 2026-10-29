//! The host delivers events to a logic plugin's `on-event` export under the same limits as
//! `start`; a plugin that traps on one stays down alone.

mod common;

use common::{MockHost, PluginDir, fine, hello_wasm_started, on_event};
use desk_plugin_host::{Limits, LogLevel, LogicHost, PluginError};
use serde_json::json;

const ID: &str = "example.hello-wasm";

#[test]
fn hello_wasm_logs_each_event_it_receives() {
    let (host, mut logic) = hello_wasm_started();
    assert!(host.lines().is_empty(), "{:?}", host.lines());

    let changed = json!({ "owner": ID, "key": "greeting", "value": "Hi" });
    assert_eq!(
        logic.deliver_event(ID, "settings.changed", &changed),
        Ok(())
    );
    let lines = host.lines();
    assert_eq!(lines.len(), 1, "{lines:?}");
    let (plugin, level, message, fields) = &lines[0];
    assert_eq!((plugin.as_str(), *level), (ID, LogLevel::Info));
    assert!(message.contains("settings.changed"), "{message}");
    assert_eq!(fields.as_ref(), Some(&changed));

    let revoked = json!({ "change": "revoked", "grantId": "g1" });
    assert_eq!(logic.deliver_event(ID, "perm.changed", &revoked), Ok(()));
    let lines = host.lines();
    assert_eq!(lines.len(), 2, "{lines:?}");
    assert!(lines[1].2.contains("perm.changed"), "{lines:?}");
    assert_eq!(lines[1].3.as_ref(), Some(&revoked));
}

#[test]
fn an_event_that_traps_leaves_other_instances_alone() {
    let broken = PluginDir::logic("test.broken", json!([]), &on_event("(unreachable)"));
    let steady = PluginDir::logic("test.steady", json!([]), &fine());
    let mut logic = LogicHost::new(MockHost::new(), Limits::default()).unwrap();
    let broken = logic.install(&broken.path).unwrap();
    let steady = logic.install(&steady.path).unwrap();
    let data = json!({ "change": "registered" });

    let first = logic.deliver_event(&broken, "cmd.changed", &data);
    assert!(matches!(first, Err(PluginError::Trap(_))), "{first:?}");
    assert_eq!(logic.deliver_event(&steady, "cmd.changed", &data), Ok(()));

    let again = logic.deliver_event(&broken, "cmd.changed", &data);
    assert!(matches!(again, Err(PluginError::Crashed(_))), "{again:?}");
    assert_eq!(logic.deliver_event(&steady, "cmd.changed", &data), Ok(()));
    assert_eq!(logic.start(&steady), Ok(()));
    assert_eq!(logic.installed(), ["test.broken", "test.steady"]);
}

#[test]
fn an_event_runs_under_the_memory_limit() {
    // 1000 pages of 64 KiB is about 62 MiB, past a 16 MiB limit.
    let hog = on_event("(drop (memory.grow (i32.const 1000)))");
    let dir = PluginDir::logic("test.hog", json!([]), &hog);
    let limits = Limits {
        memory_bytes: 16 << 20,
        ..Limits::default()
    };
    let mut logic = LogicHost::new(MockHost::new(), limits).unwrap();
    let id = logic.install(&dir.path).unwrap();

    let result = logic.deliver_event(&id, "perm.changed", &json!({}));
    assert!(
        matches!(result, Err(PluginError::MemoryLimit)),
        "{result:?}"
    );
}
