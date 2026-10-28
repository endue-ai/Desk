# desk-core

Kernel of endue Desk: the permission engine, the event bus, the plugin registry, storage, the brain
conversation with its session store and lease client, and the bridge request handler.

Layer: Rust core (see `docs/architecture.md`).

## Public API

- `Core::new(Roots { home })`, `Core::handle(caller, BridgeRequest) -> BridgeResponse`: serves
  `fs.read`, `fs.list`, `perm.*`, `plugin.*`, `store.*` and `brain.say`; other methods answer
  `unsupported` for now. `Core::grant`, `Core::revoke`, `Core::grants_of`, `Core::events`.
- Prompts: `with_prompter(impl Prompter)` shows `perm.request` as a `Prompt` (name, core-written
  `describe` summary, cleaned reason), one at a time, only within the caller's manifest, never again
  after a refusal of the same or more. `RefuseAll` (the default) refuses everything.
- Plugins: `with_plugin_store(path)`, `install_plugin(dir, built_in)`, `install_plugins_in(parent,
  built_in)`, `plugins()`, `plugin_file(id, path)`, `watch_plugins()` (hot reload). Built-in plugins
  get the permissions their manifest declares. `validate_dir(dir)`: the manifest check.
  `with_safe_mode(true)`: other plugins stay listed but get no permissions. `LaunchGuard`: launches
  that never reached ready lead to safe mode (`SafeReason`), ADR 0017.
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

## Testing

```bash
cargo test -p desk-core
```

Integration tests in `tests/`: permissions, events, bridge, plugins, store, `lease.rs` (acquire,
release, expiry, takeover) and `conversation.rs`; the last two start `examples/brain-echo` (needs Node).
