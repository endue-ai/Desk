# desk-plugin-host

Wasmtime host for logic plugins, which are Wasm components of the `desk:host` world (`specs/wit`), and
later the supervisor for MCP tool plugins (MCP runs inside desk-vm).

Layer: Rust core (see `docs/architecture.md`). Decision: ADR 0019.

## Public API

- `LogicHost::new(host, limits)`: one engine and its epoch thread. `install(dir)` reads plugin.json
  (kind `logic`), compiles the component its `entry` names and instantiates it; `start(id)` calls the
  `start` export; `reload(id)` reads the folder again, builds a new instance and starts it; `remove(id)`;
  `installed()`.
- `Host`: the desk side of every import, one method per bridge method (fs read, list and write; net
  fetch; ui notify; perm query; store get and set), called with the plugin's id. desk-core implements it.
- `Imports`: one plugin's imports. Each answers `permission-denied` for what the manifest does not
  declare (`fs:read`, `fs:write`, `net:fetch`, `ui:notify`), then calls `Host`. Store values cross the
  WIT as JSON text and reach `Host` as `serde_json::Value`.
- `Limits { memory_bytes, time }`: per instance; 64 MiB and 1 s per call (instantiation included) by
  default. Time is counted in epoch `TICK`s of 10 ms.
- `PluginError`: `Manifest`, `Compile`, `Link`, `TimeLimit`, `MemoryLimit`, `Trap`, `Guest` (`start`
  returned an error), `Crashed` (reload to run again), `NotInstalled`, `Setup`.
- The WIT types: `Error`, `ErrorCode`, `DirEntry`, `EntryKind`, `Request`, `Response`, `NotifyLevel`,
  `Grant`.

Each plugin has its own store, so a trap or a limit stops that plugin only. Guests also get WASI 0.2 with
nothing behind it (no folders, environment, arguments or network; stdio discarded), so ordinary `std`
components instantiate.

## Testing

```bash
cargo test -p desk-plugin-host
```

The tests run `examples/plugin-hello-wasm` (its committed component) and small components written in
component WAT (`tests/common`) against a mock `Host`.
