# desk-core

The Rust kernel for endue handles bridge requests, permissions, plugins, storage, history, brain conversations, `init.yaml` and its sync. The [bridge contract](../../specs/bridge/) defines the requests and responses.

## Public API

### Bridge and system access

- `Core::new(Roots { home })` creates the kernel. Call `Core::handle(caller, BridgeRequest) -> BridgeResponse` off the UI thread because requests can wait for a decision. `audio.capture.*` returns `unsupported`.
- `proc.spawn` checks the command and requires a `pty` grant and scope for a PTY. `proc.output` and `proc.exit` reach the caller only. Later calls check ownership and scope.
- `net.fetch` checks `net:fetch` (`Target::Url`) on the URL and every redirect through `desk-sys`. `net.connect` checks `net:connect` (`Target::Endpoint`) on the host and port and sends bytes to the caller.
- `ui.surface.open` requires `ui:surface` and a declared surface. `ui.surface.*` events go to `desk`. `set_surface_snapshots` attaches the shell's `SurfaceSnapshots` for `ui.surface.snapshot`. A plugin can snapshot its own surfaces.
- `db.*` opens PostgreSQL sessions through `desk-pg` under `db:connect`. Each caller owns up to 16 sessions (`database_count()`), closed on stop or grant loss (ADR 0281). `with_db_passwords` connects `db.passwords.*` to the OS keychain for login by `passwordRef`. Callers receive a reference and the password stays in the keychain (ADR 0311).
- `ssh` tunnels sessions through `desk-ssh`. Every hop needs `db:connect`. `with_db_ssh_hosts` records the caller's first trusted keys in `db-ssh-hosts.json`. A changed key requires `db.hostKeys.delete` before reconnection (ADR 0359).
- `set_web_views` attaches the shell's `WebViews` for caller-scoped `web.*` under `web:browse`, with `web_allows` and `web_changed` callbacks (ADR 0216). `web.read` and `web.act` need `web:control` at the last address the shell reported (`core_web_control.rs`, ADR 0272). `set_dialogs` attaches `Dialogs` for `dialog.*` and grants the selected item.
- `fs.read` accepts ranges. `fs.url` creates tokens for `file_url(token)` (ADR 0041). `with_history_dir(dir)` saves the contents replaced by `fs.write` (ADR 0076). `cmd.undo` and `cmd.redo` share a stack for file changes and successful commands that name an `undo` (ADR 0077). `with_opener` opens links.
- `Core::grant`, `with_grant_file(path)` and `with_prompter` configure permissions (`RefuseAll` by default, ADR 0029). `perm.request` and `shell.open` prompt holders of `perm:manage`. Agent requests must fit `agents.<id>.allow`, prompt within it, log to `perm` and hold irreversible calls (ADRs 0072 and 0078).

### Events, plugins and conversations

- `EventBus` exposes `subscribe`, `subscribe_addressed`, `publish` and `publish_to`. Inspect `subscription_count()`, `watch_count()`, `process_count()`, `surface_count()` and `file_url_count()`. `media_type(name)` resolves a media type.
- `native_launch(id)` and `native::NativeProcess::start` launch native plugins with two inherited connections and serve the bridge as the plugin. Ask the plugin to `stop`, then `kill` it after `graceMs` if needed. `native::platform()` identifies the platform (ADR 0154).
- `with_plugin_store(path)` and `with_lock_file(path)` configure storage and `plugins.lock` (`lock::{folder_sha256, parse, render, plan}`). Use `validate_dir(dir)`, `install_plugin(dir, built_in)`, `install_plugins_in`, `remove_plugin(id)`, `plugins()`, `plugin_file(id, path)` and `watch_plugins()`. Disabling a plugin removes its commands, requests, subscriptions, processes, surfaces and URLs and pauses its connectors.
- `with_store_file`, `with_settings_file`, `with_log_dir` and `Core::log` configure persistence and logging. `with_memory_dir` enables `memory.*` and `record_episode`. Turns carry memory, and `desk-remember` requires approval (ADRs 0095 and 0096).
- `with_brain(brain, BrainOptions)` and `with_brains(Brains)` configure conversation backends. `brain.use` selects endue, local, echo or claude, and falls back to local if a remote backend is unreachable (ADR 0094). `route_tools()` calls tools as the agent or Eris and records each hand-off as a `tool` step. `brain.say` presents `desk` first in words. Use `open_session` to open a session (ADRs 0089 and 0109).
- `account::Account`, `with_account` and `start_account` provide the endue ID device grant and a mode-0600 token file. `account.settings.*` uses `desk-platform` (ADR 0130). `with_local_agents(LocalAgents::new(LocalAgentsOptions::new(home, data)))` serves local agent sessions, copies and runs under `agents:manage`, including `agents.run` (ADR 0110).

### Startup and integrations

- Startup screens state files and keeps unreadable files as `<name>.broken`. Inspect `keep_broken`, `broken_in`, `broken_files()`, `with_index_file`, `keep_broken_views` and `report_broken`. `with_safe_mode(SafeReason)` and `safe_mode()` limit policies to `desk.*`. `plugins.quarantined` lives in the `desk` store. `LastStart` tracks startup (ADR 0061).
- `with_init_file`, `init()`, `init_problem()`, `with_sync`, `sync_init()` and `resolve_init(Keep)` manage `init.yaml`. `MockRemote` stands in for endue during sync. `desk_files(home, data)` checks local files (ADR 0016, #288).
- `with_index(Arc<dyn ItemIndex>)` serves `data.*` under `data:read`. `with_calendar(source)` supplies `desk.calendar` and `desk.reminders`. `with_clock` and `with_secrets_file(path)` configure the integration layer (ADR 0036). `start_connectors()`, `tick_connectors()` and `start_connector_scheduler(period)` run Wasm connectors on `desk-plugin-host`.
- `watch_views()` starts a `ViewWatcher`. `view_problems()` reports problems in `~/.desk/views/*.yaml` and plugin views marked `source: plugin`.

## Testing

Run `cargo test -p desk-core`. In `tests/`, process tests use the test executable, network tests use in-process listeners, and integration tests use a temporary index, calendar and clock. `conversation`, `agent_tools`, `approval_tools`, `directory` and `lease` start `brain-echo` and need Node. `local_agents` reads fixtures and `local_agent_runs` uses shell scripts on Unix. `db_live`, the `db-bridge` example and live database plugin tests use the PostgreSQL server named by `ENDUE_DB_TEST_POSTGRES`. The `db` tests run locally without a server.
