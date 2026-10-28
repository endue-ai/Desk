# specs/wit

`desk-host.wit` is the host interface (`desk:host`) logic plugins import as Wasm components. It is a
subset of the Desk bridge: every function is one bridge method named `<interface>.<function>`
(`fs.read`, `fs.list`, `fs.write`, `net.fetch`, `ui.notify`, `perm.query`, `store.get`, `store.set`). Calls
carry no scope; the host attaches the plugin's grant and anything not granted fails with
`permission-denied`. Store values are JSON text.

The `plugin` world also exports `start`, which the host calls after loading the plugin and after every
reload. It is a world function, not an interface, because it is not a bridge method.

Process, audio and watch calls are not available to logic plugins in v0.
`crates/desk-bridge/tests/wit.rs` parses the file and checks that every function maps to a bridge method.
