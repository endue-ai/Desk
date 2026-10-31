# desk-core

Kernel of endue Desk: the permission engine, the event bus, the plugin registry, storage, init.yaml
and its sync, the brain conversation with its session store and lease client, and the bridge handler.

Layer: Rust core (see `docs/architecture.md`).

## Public API

- `Core::new(Roots { home })`, `Core::handle(caller, BridgeRequest) -> BridgeResponse`: serves `fs.*`,
  `proc.*`, `perm.*`, `events.*`, `plugin.*`, `store.*`, `cmd.*`, `ui.notify`, `init.get` and `brain.*`;
  other methods answer `unsupported` for now. Hosts call it off their UI thread: `perm.request` waits.
- Processes (`core_proc.rs`): `proc.spawn` passes the permission engine for its command (a PTY only
  under a scope and a grant that allow `pty`), starts in the home folder unless `cwd` says where, and
  reports `proc.output` (UTF-8 split at whole characters, else base64) and `proc.exit` to its caller.
  Later calls need the owner and a scope covering the command; another caller's id is `not_found`. A
  plugin turned off or a revoked grant ends the processes it covered. `process_count()`.
- Permissions: `Core::grant` (session), `with_grant_file(path)` (`always` grants on disk, ADR 0029),
  `with_prompter` (decides when no `perm:manage` holder can be prompted; `RefuseAll` by default).
  `perm.request` becomes a `perm.prompt` to the `perm:manage` holders; the first `perm.answer` decides.
  `PermissionEngine`: deny by default; a call passes when its scope covers the target and a grant covers
  the scope; a lasting grant is used before a `once` grant, which the call spends.
- `EventBus`: `subscribe` (every event), `subscribe_addressed` (`Delivery { to, event }`, for routers),
  `publish`, `publish_to`. `events.subscribe` adds named events about every caller;
  `subscription_count()`, `watch_count()`.
- Plugins: `with_plugin_store(path)`, `install_plugin(dir, built_in)`, `install_plugins_in`, `plugins()`,
  `plugin_file(id, path)`, `watch_plugins()`. A plugin turned off takes its commands, waiting requests
  and subscriptions with it. `validate_dir(dir)`: the manifest check.
- Store: `with_store_file(path)`; one JSON value (64 KiB max) per caller and key.
- Brain: `with_brain(brain, BrainOptions)`, `open_session(id)`, `brain_session()`; `brain.say` streams
  `brain.turn` events (`OFFLINE_LINE`, `READ_ONLY_LINE`). `LeaseClient`, `SessionStore`. The directory
  (`brain.agents.*`, `brain.spaces.list`, `brain.tasks.list`) passes the brain's answers through;
  `brain.status` is `offline` while the brain is unreachable, else `BrainOptions::mode` (`BrainMode`).
- init.yaml (ADR 0016): `with_init_file(path)`, `init()`, `init_problem()`; sync: `with_sync(remote,
  state_file)`, `sync_init()`, `resolve_init(Keep)`; `MockRemote` stands in for endue.

## Testing

```bash
cargo test -p desk-core
```

Integration tests in `tests/`: permissions, events, bridge, plugins, store, cmd, fs, proc (the child
is the test binary itself), init, sync, lease, conversation and directory (the last three start `examples/brain-echo`; needs Node); `grants_store.rs`,
`prompts.rs` and `events_bridge.rs` cover grants on disk, prompts and subscriptions.
