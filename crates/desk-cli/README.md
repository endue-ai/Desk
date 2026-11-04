# desk-cli

The `desk` CLI, the hands AI agents use: plugin validate and test, doctor, a running desk's commands,
plugins, grants, logs and files, and `desk mcp` for other apps. Run it with `cargo run -p desk-cli`.

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
desk mcp [--agent <id>] [--plugin <id>]...   # an MCP server on stdio as agent:<id> (crates/desk-mcp)
```

All but `plugin validate`, `plugin test`, `doctor` and `doctor --trace` reach the running desk over its
socket (`crates/desk-ipc`, ADR 0030) as `cli`; `mcp` runs its client's calls as an agent (ADR 0086).
`DESK_SOCKET` names another socket. `--json` prints the answer as it came (`cmd run`, `describe`:
`cmd.answered`; `perm log`: each matching entry; `doctor`: JSON); `inspect` prints JSON either way. Exit
codes: 0 ok; 1 a failed check or test, a bridge error (`desk: <code>: <message>`), a failed or cancelled
command, or no desk at the socket; 2 usage. `plugin validate` prints `ok <id> <version> (<kind> plugin)`
or every problem (`desk_bridge::manifest_problems` too). `plugin test` runs on a plugin that validates:
for logic plugins and Wasm connectors each `tests/<name>.test.json` on the desk-plugin-host harness
(`ok`/`FAILED <name>`, why on stderr, then a count); for other kinds `tests/*.test.{js,ts}` with vitest
on the SDK's test host (`packages/plugin-sdk/vitest.plugin.config.ts` here or in `DESK_REPO`); none yet
for tool plugins.

## Testing
`cargo test -p desk-cli`: a scripted server (`socket.rs`, `perm_log.rs`, `describe.rs`, `inspect.rs`), a
real socket and `Core` (`round_trip.rs`, `fs_history.rs`, `mcp.rs`), and the rest of `tests/` on files.
