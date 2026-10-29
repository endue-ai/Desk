# desk-plugin-host

Wasmtime host for logic plugins, which are Wasm components of the `desk:host` world (`specs/wit`), and
later the supervisor for MCP tool plugins (MCP runs inside desk-vm).

Layer: Rust core (see `docs/architecture.md`). Decision: ADR 0019.

## Public API

- `LogicHost::new(host, limits)`: one engine and its epoch thread. `install(dir)` reads plugin.json
  (kind `logic`), compiles the component its `entry` names and instantiates it; `start(id)` calls the
  `start` export; `deliver_command(id, invocation_id, command_id, &args)` and `deliver_event(id, name,
  &data)` call `on-command` and `on-event`; `reload(id)` builds a new instance from the folder and
  starts it; `remove(id)`; `installed()`.
- `Host`: the desk side of every import, one method per bridge method (fs, net, ui notify, perm query and
  request, store, cmd, events, settings, log), called with the plugin's id. desk-core implements it.
- `Imports`: one plugin's imports. Each answers `permission-denied` for what the manifest does not
  declare (`fs:read`, `fs:write`, `net:fetch`, `ui:notify`, `cmd:invoke`, `events:subscribe`,
  `settings:read` for others' settings, `log:read`), then calls `Host`. JSON crosses the WIT as text
  (`invalid-params` when it is not JSON) and reaches `Host` as `serde_json::Value`.
- `Limits { memory_bytes, time }`: per instance; 64 MiB and 1 s per call (instantiation included) by
  default. Time is counted in epoch `TICK`s of 10 ms.
- `PluginError`: `Manifest`, `Compile`, `Link`, `TimeLimit`, `MemoryLimit`, `Trap`, `Guest` (an export
  returned an error), `Crashed` (reload to run again), `NotInstalled`, `Setup`.
- The WIT types: `Error`, `ErrorCode`, `DirEntry`, `EntryKind`, `Request`, `Response`, `NotifyLevel`,
  `Grant`, `Duration`, `Decision`, `Command`, `CommandInfo`, `Failure`, `FailureCode`, `Setting`,
  `LogLevel`, `LogEntry`.

Each plugin has its own store, so a trap or a limit stops that plugin only. Guests also get WASI 0.2 with
nothing behind it (no folders, environment, arguments or network; stdio discarded), so ordinary `std`
components instantiate.

## Testing

```bash
cargo test -p desk-plugin-host
```

The tests run `examples/plugin-hello-wasm` (its committed component) and small components written in
component WAT (`tests/common/wat.rs`) against a mock `Host` (`tests/common/mock.rs`).
