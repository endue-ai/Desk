# desk-core

Kernel of endue Desk: the permission engine, the event bus, the plugin registry, storage, the brain
conversation with its session store and lease client, and the bridge request handler.

Layer: Rust core (see `docs/architecture.md`).

## Public API

- `Core::new(Roots { home })`, `Core::handle(caller, BridgeRequest) -> BridgeResponse`: serves
  `fs.*`, `perm.*`, `plugin.*`, `store.*` and `brain.say`; other methods answer `unsupported` for now.
  `grant`, `revoke`, `grants_of`, `events`. Work a caller starts (watches) ends when its grant is
  revoked or the plugin is turned off.
- Files: paths are normalised lexically, then no component below the literal part of the grant may be
  a symbolic link. `fs.write` (with `createDirs` only inside the scope), `fs.watch` (`fs.changed`
  with bridge paths, bursts coalesced).
- Prompts: `with_prompter(impl Prompter)` shows `perm.request` as a `Prompt` (name, `describe`
  summary, cleaned reason), one at a time, only within the caller's manifest, never again after a
  refusal of the same or more (ADR 0016). `RefuseAll`, the default, refuses everything.
- Plugins: `with_plugin_store`, `install_plugin(dir, built_in)`, `install_plugins_in`, `plugins()`,
  `plugin_file`, `watch_plugins()` (hot reload); built-ins get their manifest's permissions.
  `validate_dir(dir)`. Safe mode (ADR 0017): `with_safe_mode(true)` gives other plugins nothing;
  `LaunchGuard` turns launches that never reached ready into a `SafeReason`.
- `PermissionEngine`: deny by default; a call passes when its scope covers the target (path, command,
  host) and a grant covers the scope.
- Store: `with_store_file(path)`; one JSON value (64 KiB max) per caller and key.
- Brain: `with_brain(brain, BrainOptions)`, `open_session(id)`, `brain_session()`. `brain.say` streams
  `brain.turn` events; offline turns get `OFFLINE_LINE` and resume; a desk that lost its lease answers
  `READ_ONLY_LINE`. `LeaseClient`, `SessionStore`. `EventBus`: `subscribe`, `publish`.

## Testing

```bash
cargo test -p desk-core
```

Integration tests in `tests/`: permissions, prompt, safe_mode, files, events, bridge, plugins, store,
`lease.rs` and `conversation.rs`; the last two start `examples/brain-echo` (needs Node).
