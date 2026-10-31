# desk-core

Kernel of endue Desk: the permission engine, the event bus, the plugin registry, storage, init.yaml
and its sync, the brain conversation with its session store and lease client, the integration layer
(the item index, connectors, views) and the bridge handler. Layer: Rust core (`docs/architecture.md`).

## Public API

- `Core::new(Roots { home })`, `Core::handle(caller, BridgeRequest) -> BridgeResponse`: serves `fs.*`
  (`fs.list` with `modifiedAt`), `perm.*`, `events.*`, `plugin.*`, `store.*`, `cmd.*`, `ui.notify`,
  `init.get`, `brain.*`, `data.*`, `connector.*`, `view.*` and `catalog.get`; others answer
  `unsupported`. Hosts call it off their UI thread: `perm.request` and `connector.connect` wait.
- Permissions: `Core::grant` (session), `with_grant_file(path)` (`always` grants, ADR 0029),
  `with_prompter` (`RefuseAll` by default); `perm.request` becomes a `perm.prompt` to the
  `perm:manage` holders. `PermissionEngine`: deny by default; a `once` grant is spent by its call.
- `EventBus`: `subscribe`, `subscribe_addressed` (`Delivery { to, event }`), `publish`, `publish_to`;
  `subscription_count()`, `watch_count()`.
- Plugins: `with_plugin_store(path)`, `install_plugin(dir, built_in)`, `install_plugins_in`,
  `plugins()`, `plugin_file(id, path)`, `watch_plugins()`, `validate_dir(dir)`. A plugin turned off
  takes its commands, waiting requests and subscriptions with it, and pauses its connector instances.
- Store: `with_store_file(path)`; one JSON value (64 KiB max) per caller and key.
- Brain: `with_brain(brain, BrainOptions)`, `open_session(id)`, `brain_session()`, `LeaseClient`,
  `SessionStore`; `brain.say` streams `brain.turn`; the directory passes the brain's answers through.
- init.yaml (ADR 0016): `with_init_file(path)`, `init()`, `init_problem()`, `with_sync(remote,
  state_file)`, `sync_init()`, `resolve_init(Keep)`; `MockRemote` stands in for endue.
- Integration layer (ADR 0036): `with_index(Arc<dyn ItemIndex>)` (`data.*` under `data:read`),
  `with_calendar(source)` (the built-ins `desk.calendar` and `desk.reminders`), `with_clock`,
  `with_secrets_file(path)`; then `start_connectors()` (Wasm connectors on `desk-plugin-host`),
  `tick_connectors()`, `start_connector_scheduler(period)`; `watch_views()` (`ViewWatcher`) and
  `view_problems()` over `~/.desk/views/*.yaml`.

## Testing

```bash
cargo test -p desk-core
```

`tests/` covers each side; `conversation`, `directory` and `lease` start `examples/brain-echo` (needs
Node). The integration layer's tests (`data`, `connectors`, `connectors_wasm`, `views`, `catalog`)
run on a temp index, a `FakeCalendar`, a fake clock and an explicit tick (helpers in `tests/layer`).
