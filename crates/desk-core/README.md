# desk-core

Kernel of endue Desk: the permission engine, the event bus, the plugin registry and the bridge request
handler. Storage beyond plugin flags and the session lease client come later.

Layer: Rust core (see `docs/architecture.md`).

## Public API

- `Core::new(Roots { home })`, `Core::handle(caller, BridgeRequest) -> BridgeResponse`: serves
  `fs.read`, `fs.list`, `perm.*` and `plugin.*`; every other method answers `unsupported` for now.
  `Core::grant`, `Core::events`, `Core::with_prompter`.
- Plugins: `with_plugin_store(path)`, `install_plugin(dir, built_in)`, `install_plugins_in(parent,
  built_in)`, `plugins()`, `plugin_file(id, path)`, `watch_plugins()` (hot reload, `PluginWatcher`).
  Built-in plugins get the permissions their manifest declares.
- `PluginRegistry`: validation status, revisions, enabled flags persisted in a JSON store, file
  serving that refuses paths leaving the plugin folder. `validate_dir(dir)`: the manifest check.
- `PermissionEngine`: deny by default; `grant`, `revoke`, `grants`, `authorize(caller, scope, target)`.
  A call passes when its scope covers the target (path, command, host) and a grant covers the scope.
  Paths are normalised lexically; a `..` that leaves its root is denied.
- `EventBus`: `subscribe`, `publish`, `subscriber_count`.
- `Prompter` / `RefuseAll`: who answers `perm.request` (refuses until the prompt UI exists).

## Testing

```bash
cargo test -p desk-core
```

Integration tests: `tests/permissions.rs`, `tests/events.rs`, `tests/bridge.rs`, `tests/plugins.rs`.
