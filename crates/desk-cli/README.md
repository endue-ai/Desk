# desk-cli

The `desk` CLI: plugin validate and test, doctor (state check) and doctor --trace, and a running desk's commands, plugins,
grants, permission log, files and log. The hands AI agents use. Layer: Rust core. From the repo:
`cargo run -p desk-cli -- <command>`; CI validates every plugin folder.

## Commands
```bash
desk plugin validate <dir>             # plugin.json against specs/plugin v0; entry and view files exist
desk doctor [--data <dir>]             # quarantined plugins and .broken state files (ADR 0061); exits 0
desk plugin test <dir>                 # the folder's tests/ on the host for its kind
desk ping                              # a round trip to the running desk; prints ok
desk cmd list                          # id<TAB>provider<TAB>title per command
desk cmd run <id> [--args <json>]      # waits for cmd.answered; prints the result as JSON
desk plugin list                       # id<TAB>status<TAB>enabled|disabled per plugin
desk plugin enable|disable <id>        # prints ok
desk perm list | revoke <grantId>      # grantId<TAB>caller<TAB>permission per grant; revoke prints ok
desk perm log [--agent <id>]           # at, caller, decision, permission, target, reason or approval
desk describe key|command|setting|plugin|grant <x>   # desk.describe.open's answer, as text (ADR 0075)
desk inspect [tree|surfaces|commands|grants|settings|plugins|calls]   # the inspector's Export JSON
desk fs history|restore <path> ...    # [--limit <n>]: id, at, caller, size per version; <version>: ok
desk log [--count <n>] | undo | redo  # the log, oldest first; or what was undone or redone (ADR 0077)
desk doctor --trace <file>             # a DESK_TRACE=1 trace.json: phases, totals, the five longest
```

All but `plugin validate`, `plugin test`, `doctor` and `doctor --trace` reach the running desk over its socket
(`crates/desk-ipc`, ADR 0030) as the caller `cli`; `DESK_SOCKET` names another socket. `--json` prints
the answer as it came (`cmd run`, `describe`: `cmd.answered`; `perm log`: each matching entry; `doctor`:
JSON); `inspect` prints JSON either way. Exit codes: 0 ok; 1 a failed check or test, a bridge error
(`desk: <code>: <message>`), a failed or cancelled command, or no desk at the socket; 2 usage. `plugin
validate` prints `ok <id> <version> (<kind> plugin)` or every problem (`desk_bridge::manifest_problems`
included). `plugin test` runs on a plugin that validates. Logic plugins and Wasm connectors: each
`tests/<name>.test.json` on the desk-plugin-host harness (`ok`/`FAILED <name>`, why on stderr, then a
count). Other kinds: `tests/*.test.{js,ts}` with vitest on the SDK's test host, from the checkout the
binary was built in or `DESK_REPO` (`packages/plugin-sdk/vitest.plugin.config.ts`). Tool, MCP: none yet.

## Testing
`cargo test -p desk-cli`: `tests/socket.rs`, `perm_log.rs`, `describe.rs` (the runtime's golden texts)
and `inspect.rs` (the inspector's) on a scripted server, `doctor.rs` on handmade traces, `round_trip.rs`
and `fs_history.rs` (ADR 0076) on a real `desk_ipc::Listener` and `Core`, `plugin_test.rs` and
`templates.rs` (every create-plugin kind built and tested; needs `node`, `pnpm install`).
