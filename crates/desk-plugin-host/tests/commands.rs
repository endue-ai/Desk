//! A logic plugin provides commands: it registers them through `cmd`, and the host delivers each
//! invocation to its `on-command` export under the same limits as `start`.

mod common;

use std::time::{Duration, Instant};

use common::{MockHost, PluginDir, fine, hello_wasm_started, on_command};
use desk_plugin_host::{ErrorCode, Limits, LogLevel, LogicHost, PluginError};
use serde_json::{Value, json};

const ID: &str = "example.hello-wasm";
const GREET: &str = "example.hello-wasm.greet";

#[test]
fn hello_wasm_registers_its_command_on_start() {
    let (host, _logic) = hello_wasm_started();

    let registered = host.registered();
    assert_eq!(registered.len(), 1, "{registered:?}");
    let (plugin, command) = &registered[0];
    assert_eq!(plugin, ID);
    assert_eq!(command.id, GREET);
    assert!(!command.title.is_empty(), "{command:?}");
    let schema = command.args_schema.as_deref().expect("an args schema");
    let schema: Value = serde_json::from_str(schema).unwrap();
    assert_eq!(schema["type"], "object");
    assert_eq!(schema["properties"]["name"]["type"], "string");
    assert_eq!(schema["required"], json!(["name"]));
}

#[test]
fn hello_wasm_answers_an_invocation_and_logs_one_line_per_call() {
    let (host, mut logic) = hello_wasm_started();

    let ada = logic.deliver_command(ID, "inv-1", GREET, &json!({ "name": "Ada" }));
    assert_eq!(ada, Ok(()));
    assert_eq!(
        host.answers(),
        [(ID.to_owned(), "inv-1".to_owned(), Ok(json!("Hello, Ada!")))]
    );
    let lines = host.lines();
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert_eq!((lines[0].0.as_str(), lines[0].1), (ID, LogLevel::Info));
    assert!(lines[0].2.contains("Ada"), "{lines:?}");

    let grace = logic.deliver_command(ID, "inv-2", GREET, &json!({ "name": "Grace" }));
    assert_eq!(grace, Ok(()));
    let answers = host.answers();
    assert_eq!(answers.len(), 2, "{answers:?}");
    assert_eq!(
        answers[1],
        (
            ID.to_owned(),
            "inv-2".to_owned(),
            Ok(json!("Hello, Grace!"))
        )
    );
    let lines = host.lines();
    assert_eq!(lines.len(), 2, "{lines:?}");
    assert_eq!(lines[1].1, LogLevel::Info);
    assert!(lines[1].2.contains("Grace"), "{lines:?}");
}

#[test]
fn an_invocation_of_a_command_hello_wasm_does_not_provide_is_not_found() {
    let (host, mut logic) = hello_wasm_started();

    let missing = logic.deliver_command(ID, "inv-1", "example.hello-wasm.missing", &json!({}));
    match missing {
        Err(PluginError::Guest(e)) => assert_eq!(e.code, ErrorCode::NotFound),
        other => panic!("expected not-found from the guest, got {other:?}"),
    }
    assert!(host.answers().is_empty(), "{:?}", host.answers());

    let next = logic.deliver_command(ID, "inv-2", GREET, &json!({ "name": "Ada" }));
    assert_eq!(next, Ok(()));
    let answered: Vec<String> = host.answers().into_iter().map(|a| a.1).collect();
    assert_eq!(answered, ["inv-2"]);
}

#[test]
fn a_command_that_traps_marks_the_plugin_crashed_until_reloaded() {
    let dir = PluginDir::logic("test.trap", json!([]), &on_command("(unreachable)"));
    let mut logic = LogicHost::new(MockHost::new(), Limits::default()).unwrap();
    let id = logic.install(&dir.path).unwrap();
    let args = json!({});

    let first = logic.deliver_command(&id, "inv-1", "test.trap.run", &args);
    assert!(matches!(first, Err(PluginError::Trap(_))), "{first:?}");
    let after = [
        logic.deliver_command(&id, "inv-2", "test.trap.run", &args),
        logic.deliver_event(&id, "perm.changed", &json!({})),
        logic.start(&id),
    ];
    for result in after {
        assert!(matches!(result, Err(PluginError::Crashed(_))), "{result:?}");
    }

    dir.write("plugin.wasm", &fine());
    logic.reload(&id).unwrap();
    let again = logic.deliver_command(&id, "inv-3", "test.trap.run", &args);
    assert_eq!(again, Ok(()));

    let nobody = logic.deliver_command("test.nobody", "inv-4", "test.nobody.run", &args);
    assert!(
        matches!(nobody, Err(PluginError::NotInstalled(_))),
        "{nobody:?}"
    );
}

#[test]
fn a_command_runs_under_the_time_limit() {
    let spin = on_command("(loop $forever (br $forever))");
    let dir = PluginDir::logic("test.spin", json!([]), &spin);
    let limits = Limits {
        time: Duration::from_millis(200),
        ..Limits::default()
    };
    let mut logic = LogicHost::new(MockHost::new(), limits).unwrap();
    let id = logic.install(&dir.path).unwrap();

    let started = Instant::now();
    let result = logic.deliver_command(&id, "inv-1", "test.spin.run", &json!({}));
    assert!(matches!(result, Err(PluginError::TimeLimit)), "{result:?}");
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "{:?}",
        started.elapsed()
    );
}
