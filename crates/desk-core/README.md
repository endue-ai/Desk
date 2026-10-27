# desk-core

Kernel of endue Desk: the permission engine, the event bus and the bridge request handler. Storage,
the plugin registry and the session lease client come later.

Layer: Rust core (see `docs/architecture.md`).

## Public API

- `Core::new(Roots { home })`, `Core::handle(caller, BridgeRequest) -> BridgeResponse`: serves
  `fs.read`, `fs.list` and `perm.*`; every other method answers `unsupported` for now.
  `Core::grant`, `Core::events`, `Core::with_prompter`.
- `PermissionEngine`: deny by default; `grant`, `revoke`, `grants`, `authorize(caller, scope, target)`.
  A call passes when its scope covers the target (path, command, host) and a grant covers the scope.
  Paths are normalised lexically; a `..` that leaves its root is denied.
- `EventBus`: `subscribe`, `publish`, `subscriber_count`.
- `Prompter` / `RefuseAll`: who answers `perm.request` (refuses until the prompt UI exists).

## Testing

```bash
cargo test -p desk-core
```

`tests/permissions.rs`, `tests/events.rs` and `tests/bridge.rs` are the integration tests.
