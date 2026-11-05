# desk-core

Kernel of endue Desk: permissions, events, plugins, storage and the history of writes, init.yaml and
its sync, the brain conversation, the integration layer and the bridge handler. Layer: Rust core.

## Public API

- `Core::new(Roots { home })`, `Core::handle(caller, BridgeRequest) -> BridgeResponse`: every method
  but `audio.capture.*` (`unsupported`). Call it off the UI thread: `perm.request` and others wait.
- `proc.spawn` passes the permission engine for its command (a PTY only where scope and grant allow
  `pty`); `proc.output` and `proc.exit` reach the caller only; later calls need owner and scope.
- `net.fetch` checks the URL against the `net:fetch` scope (`Target::Url`), desk-sys every redirect;
  `ui.surface.open` needs `ui:surface` and a declared surface, and `ui.surface.*` events go to `desk`.
- Files: `fs.read` ranges, `fs.url` tokens for `file_url(token)` (ADR 0041); `with_history_dir(dir)`:
  each `fs.write` keeps what it replaces (ADR 0076), undone like an ok answer of a command naming an
  `undo` through `cmd.undo`/`cmd.redo` on one desk stack (ADR 0077). Links: `with_opener`.
- Permissions: `Core::grant`, `with_grant_file(path)` (ADR 0029), `with_prompter` (`RefuseAll`);
  `perm.request` and `shell.open` prompt the `perm:manage` holders. Agents (ADR 0072): capped by
  `agents.<id>.allow`, prompted inside it, logged on `perm`; irreversible calls held (ADR 0078).
- `EventBus`: `subscribe`, `subscribe_addressed`, `publish`, `publish_to`; `subscription_count()`,
  `watch_count()`, `process_count()`, `surface_count()`, `file_url_count()`; `media_type(name)`.
- Plugins: `with_plugin_store(path)`, `install_plugin(dir, built_in)`, `install_plugins_in`,
  `plugins()`, `plugin_file(id, path)`, `watch_plugins()`, `validate_dir(dir)`. A plugin turned off
  takes its commands, requests, subscriptions, processes, surfaces and URLs; its connectors pause.
- Storage: `with_store_file`, `with_settings_file`, `with_log_dir`, `Core::log`. Settings are checked
  against their declarations; `settings_problems()` names what fails, by file and line (ADR 0080).
  Brain: `with_brain(brain, BrainOptions)` or `with_brains(Brains)` (the runtime's `brain.use` picks
  endue, local or echo; an unreachable remote falls back to local, ADR 0094), `route_tools()` (calls as
  their agent, or as Eris; each hand-off is a `tool` step, ADR 0089), `open_session`. endue ID:
  `account::Account` (device grant, token file 0600), `with_account`, `start_account` (account.*).
  Local agents (ADR 0110): `with_local_agents(LocalAgents::new(LocalAgentsOptions::new(home, data)))`
  serves agents.* (`agents:manage`): Claude Code's and Codex's sessions, copies, runs (`agents.run`).
- Start (ADR 0061): every state file is screened as it loads; an unreadable one is kept as
  `<name>.broken` (`keep_broken`, `broken_in`) and listed by `broken_files()`; `with_index_file`,
  `keep_broken_views`, `report_broken`. `with_safe_mode(SafeReason)` and `safe_mode()` hold all but
  the desk.* policies off; `plugins.quarantined` in `desk`'s store holds its plugins; `LastStart`.
- init.yaml (ADR 0016): `with_init_file(path)`, `init()`, `init_problem()`, `with_sync(remote,
  state_file)`, `sync_init()`, `resolve_init(Keep)`; `MockRemote` stands in for endue.
- Integration layer (ADR 0036): `with_index(Arc<dyn ItemIndex>)` (`data.*` under `data:read`),
  `with_calendar(source)` (the built-ins `desk.calendar` and `desk.reminders`), `with_clock`,
  `with_secrets_file(path)`; then `start_connectors()` (Wasm connectors on `desk-plugin-host`),
  `tick_connectors()`, `start_connector_scheduler(period)`; `watch_views()` (`ViewWatcher`) and
  `view_problems()` over `~/.desk/views/*.yaml` and the view plugins' views (`source: plugin`).

## Testing

`cargo test -p desk-core`. `tests/` covers each side (`proc`'s child is the test binary itself; `net`
serves from in-process listeners; `conversation`, `agent_tools`, `approval_tools`, `directory`, `lease`
start brain-echo, needs Node); the integration layer runs on a temp index, a fake calendar and clock;
`local_agents` reads fixture folders, `local_agent_runs` runs shell scripts as the programs (Unix).
