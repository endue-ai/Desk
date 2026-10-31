# specs/wit

Two packages, parsed as one folder. `desk-host.wit` is the host interface (`desk:host`) logic plugins
import as Wasm components. It is a subset of the Desk bridge: every function is one bridge method named
`<interface>.<function>`. `desk-connector.wit` holds the nested package `desk:connector`, the world Wasm
connectors build to (below); it has no top-level `package` line, so the folder stays one main package.

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
declares no surfaces to open. `fs.list` entries carry `modified-at` (RFC 3339 in UTC), none when the
desk cannot tell.

## The connector world

`desk:connector/connector` is what a plugin of kind `connector` with `binding: wasm` builds to
(`specs/connector/v0`, ADR 0034). It imports `fs`, `net`, `perm`, `store` and `log` from `desk:host`
(no `ui`, `cmd`, `events` or `settings`) and exports four world functions the host calls:

| Export | The host calls it |
| --- | --- |
| `sync(instance, cursor)` | On the manifest's interval and on demand; again at once while `done` is false |
| `query(instance, query)` | For a live query beyond the index; `unsupported` when there is none |
| `act(instance, action, args-json)` | For an action in `resources[].actions`, which the host checks first |
| `status(instance)` | When an instance is created: ok, or the reason it cannot sync |

`desk:connector/types` mirrors `specs/item/v0` without `source`: the host stamps `{ connector,
instance }` on every item, so a connector writes only under its own. Settings, an item's kind fields
(`details`) and `raw`, query conditions and sort, and action args and results cross as JSON text, which
the host checks (`invalid-params`). `crates/desk-bridge/tests/wit.rs` parses the folder and checks
that every interface function maps to a bridge method and what each world imports and exports.
