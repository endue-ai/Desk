# desk-plugin-host

Wasmtime host for logic plugins (the `desk:host` world) and Wasm connectors (the `desk:connector`
world, `specs/wit`), and later the supervisor for MCP tool plugins (MCP runs inside desk-vm).

Layer: Rust core (see `docs/architecture.md`). Decisions: ADR 0019, ADR 0034.

## Public API

- `LogicHost::new(host, limits)`: `install(dir)` (kind `logic`), `start`, `deliver_command`,
  `deliver_event`, `reload`, `remove`, `installed`.
- `ConnectorHost::new(host, sink, clock, limits)`: `install` (kind `connector`, `binding: wasm`),
  `reload`, `remove`, `installed`; `create_instance(id, instance, settings)` (checked against
  `instanceSettings`, secrets never kept), `remove_instance`, `instances`, `status`, `pause`, `resume`;
  `tick` (every due sync: the interval, rounds while not `done`, backoff 30 s doubling to 1 h),
  `sync_now`, `query`, `act` (declared actions only), `watch_status`, `start_scheduler(period)`.
- `IndexSink`: `upsert`, `remove`, `clear`; every item stamped with its `source` and checked against
  specs/item/v0. `Clock` (`SystemClock`, `rfc3339`): when syncs are due.
- `Host`: the desk side of every import, one method per bridge method, called with the plugin's id.
- `Imports`: one plugin's imports, refused (`permission-denied`) for what the manifest does not
  declare and for store keys under `desk.`, which hold a connector's instances and cursors. JSON
  crosses the WIT as text (`invalid-params` when it is not JSON).
- `Limits { memory_bytes, time }`: 64 MiB and 1 s per call by default, in epoch `TICK`s of 10 ms.
- `PluginError`: `Manifest`, `Compile`, `Link`, `TimeLimit`, `MemoryLimit`, `Trap`, `Guest`, `Crashed`,
  `NotInstalled`, `NoInstance`, `Paused`, `Host` (the host refused), `Setup`; and the WIT types.

Each logic plugin and each connector has its own store, so a trap or a limit stops it alone (every
instance of a connector goes to `error` until a reload). Guests get WASI 0.2 with nothing behind it.

## Testing

```bash
cargo test -p desk-plugin-host
```

The tests run `examples/plugin-hello-wasm` and `examples/plugin-hello-connector` (their committed
components) and component WAT (`tests/common`) against a mock `Host`, a recording sink, a fake clock.
