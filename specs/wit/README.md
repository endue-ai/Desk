# specs/wit

`desk-host.wit` is the host interface (`desk:host`) logic plugins import as Wasm components. It is a
subset of the Desk bridge: every function is one bridge method named `<interface>.<function>`.

| Interface | Bridge methods |
| --- | --- |
| `fs` | `fs.read`, `fs.list`, `fs.write` |
| `net` | `net.fetch` |
| `ui` | `ui.notify` |
| `perm` | `perm.query`, `perm.request` |
| `store` | `store.get`, `store.set` |
| `cmd` | `cmd.register`, `cmd.unregister`, `cmd.list`, `cmd.invoke`, `cmd.answer` |
| `events` | `events.subscribe`, `events.unsubscribe` |
| `settings` | `settings.get`, `settings.set`, `settings.list` |
| `log` | `log.write`, `log.tail` |

Calls carry no scope; the host attaches the plugin's grant and anything not granted fails with
`permission-denied`. JSON (store and setting values, command args, schemas and results, log fields, the
permission `perm.request` asks for) crosses as text.

The `plugin` world exports three functions the host calls: `start` after loading the plugin and after
every reload; `on-command(invocation-id, command-id, args-json)` for each invocation of one of its own
commands, answered through `cmd.answer`; `on-event(name, data-json)` for the events about its own work
(`cmd.answered`, `settings.changed`, `perm.changed`) and those it subscribed to. They are world functions,
not interfaces, because they are not bridge methods.

Process, audio and watch calls are not available to logic plugins in v0. Nor are `ui.surface.open` and
`ui.surface.close`: no `<interface>.<function>` name can hold their inner dot, and a logic plugin
declares no surfaces to open. `crates/desk-bridge/tests/wit.rs` parses the file and checks that every
function maps to a bridge method.
