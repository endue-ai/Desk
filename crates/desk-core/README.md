# desk-core

Kernel of endue Desk: the permission engine, the event bus, the plugin registry, storage, init.yaml
and its sync, the brain conversation with its session store and lease client, and the bridge handler.

Layer: Rust core (see `docs/architecture.md`).

## Public API

- `Core::new(Roots { home })`, `Core::handle(caller, BridgeRequest) -> BridgeResponse`: serves
  `fs.read`, `fs.list`, `perm.*`, `plugin.*`, `store.*` and `brain.say`; other methods answer
  `unsupported` for now. `Core::grant`, `Core::events`, `Core::with_prompter`.
- Plugins: `with_plugin_store(path)`, `install_plugin(dir, built_in)`, `install_plugins_in(parent,
  built_in)`, `plugins()`, `plugin_file(id, path)`, `watch_plugins()` (hot reload). Built-in plugins
  get the permissions their manifest declares. `validate_dir(dir)`: the manifest check.
- `PermissionEngine`: deny by default; a call passes when its scope covers the target (path, command,
  host) and a grant covers the scope. Paths are normalised lexically.
- Store: `with_store_file(path)`; one JSON value (64 KiB max) per caller and key.
- Brain: `with_brain(brain, BrainOptions)`, `open_session(id)` (takes the lease over),
  `brain_session()`. `brain.say` streams `brain.turn` events; an unreachable brain gets
  `OFFLINE_LINE` and the turn resumes on reconnection; a desk that lost its lease answers
  `READ_ONLY_LINE`. The echo tool runs inside the core.
- `LeaseClient`: `acquire(session, takeover)`, `renew`, `release`, `ensure`, `is_read_only`.
  `SessionStore`: the desk id, its session and the recent transcript in one JSON file.
- `EventBus`: `subscribe`, `publish`; clones share subscribers.
- init.yaml (ADR 0016): `with_init_file(path)` writes `INIT_TEMPLATE` when there is none; `init()`,
  `init_problem()` (a broken file leaves the defaults in force). `plugins.disabled` holds plugins off.
- Sync: `with_sync(remote, state_file)`, `sync_init()` (`UpToDate`, `Pushed`, `Pulled`, `Conflict`:
  endue's copy goes to `init.remote.yaml`), `resolve_init(Keep)`. `SyncRemote` is endue's side;
  `MockRemote` stands in for it until endue serves sync.

## Testing

```bash
cargo test -p desk-core
```

Integration tests in `tests/`: permissions, events, bridge, plugins, store, `init.rs`, `sync.rs` (two
desks through one `MockRemote`), `lease.rs` (acquire, release, expiry, takeover) and `conversation.rs`;
the last two start `examples/brain-echo` (needs Node).
