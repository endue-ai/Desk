# desk-core

Kernel of endue Desk: the permission engine, the event bus, the plugin registry, storage, init.yaml
and its sync, the brain conversation with its session store and lease client, the integration layer
(the item index, connectors, views) and the bridge handler. Layer: Rust core (`docs/architecture.md`).

## Public API

- `Core::new(Roots { home })`, `Core::handle(caller, BridgeRequest) -> BridgeResponse`: every method
  but `audio.capture.*` (`unsupported`). Call it off the UI thread: `perm.request` and others wait.
- `proc.spawn` passes the permission engine for its command (a PTY only where scope and grant allow
  `pty`); `proc.output` and `proc.exit` reach the caller only; later calls need owner and scope.
- `net.fetch` checks the URL against the `net:fetch` scope (`Target::Url`), desk-sys every redirect;
  `ui.surface.open` needs `ui:surface` and a declared surface, and `ui.surface.*` events go to `desk`.
- Files (ADR 0041): `fs.read` reads ranges; `fs.url` makes a 128-bit token that `file_url(token)`
  resolves to a `FileUrl` while its caller runs and holds the grant. Links (ADR 0047): `with_opener`.
- Permissions: `Core::grant`, `with_grant_file(path)` (`always`, ADR 0029), `with_prompter` (`RefuseAll`
  by default); `perm.request`, and `shell.open` without a grant, prompt the `perm:manage` holders
  (`perm.prompt`). `PermissionEngine`: deny by default; a `once` grant is spent by its call.
- `EventBus`: `subscribe`, `subscribe_addressed`, `publish`, `publish_to`; `subscription_count()`,
  `watch_count()`, `process_count()`, `surface_count()`, `file_url_count()`; `media_type(name)`.
- Plugins: `with_plugin_store(path)`, `install_plugin(dir, built_in)`, `install_plugins_in`,
  `plugins()`, `plugin_file(id, path)`, `watch_plugins()`, `validate_dir(dir)`. A plugin turned off
  takes its commands, requests, subscriptions, processes, surfaces and URLs; its connectors pause.
- Storage: `with_store_file(path)`, `with_settings_file(path)`, `with_log_dir(dir)`, `Core::log`.
  Brain: `with_brain(brain, BrainOptions)`, `open_session(id)`, `brain_session()`, `LeaseClient`,
  `SessionStore`; `brain.say` streams `brain.turn`; the directory passes the brain's answers through.
- init.yaml (ADR 0016): `with_init_file(path)`, `init()`, `init_problem()`, `with_sync(remote,
  state_file)`, `sync_init()`, `resolve_init(Keep)`; `MockRemote` stands in for endue.
- Integration layer (ADR 0036): `with_index(Arc<dyn ItemIndex>)` (`data.*` under `data:read`),
  `with_calendar(source)` (the built-ins `desk.calendar` and `desk.reminders`), `with_clock`,
  `with_secrets_file(path)`; then `start_connectors()` (Wasm connectors on `desk-plugin-host`),
  `tick_connectors()`, `start_connector_scheduler(period)`; `watch_views()` (`ViewWatcher`) and
  `view_problems()` over `~/.desk/views/*.yaml` and the view plugins' views (`source: plugin`).

## Testing

`cargo test -p desk-core`. `tests/` covers each side (`proc`'s child is the test binary itself; `net`
serves from in-process listeners; `conversation`, `directory` and `lease` start `examples/brain-echo`,
needs Node); the integration layer runs on a temp index, a `FakeCalendar` and a fake clock (`layer`).
