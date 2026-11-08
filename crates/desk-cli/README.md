# desk-cli

The `desk` CLI, the hands AI agents use: plugin validate and test, doctor, export and import, a running
desk's commands, plugins, grants, logs and files, and `desk mcp` for other apps (`cargo run -p desk-cli`).

## Commands
```bash
desk plugin validate <dir>             # plugin.json against specs/plugin v0; entry and view files exist
desk doctor [--data <dir>]             # quarantined, .broken, then file<TAB>path<TAB>owner<TAB>size<TAB>state
desk export|import <dir|file.zip> [--with-data]   # a desk as files; import keeps an existing init.yaml
desk plugin test <dir>                 # the folder's tests/ on the host for its kind
desk ping                              # a round trip to the running desk; prints ok
desk cmd list | tools [<words>]        # id<TAB>provider<TAB>title; tools: agents' (ADR 0088), reads|acts|irreversible
desk cmd run <id> [--args <json>]      # waits for cmd.answered; prints the result as JSON
desk plugin list [--lock]              # id<TAB>status<TAB>enabled|disabled; --lock: ~/.desk/plugins.lock
desk plugin enable|disable <id> | sync # ok; sync: on and off as plugins.lock says, missing ones exit 1
desk perm list | revoke <grantId>      # grantId<TAB>caller<TAB>permission per grant; revoke prints ok
desk perm log [--agent <id>]           # at, caller, decision, permission, target, reason or approval
desk describe key|command|setting|plugin|grant <x>   # desk.describe.open's answer, as text (ADR 0075)
desk inspect [tree|surfaces|commands|grants|settings|plugins|calls]   # the inspector's Export JSON
desk fs history|restore <path> ...    # [--limit <n>]: id, at, caller, size per version; <version>: ok
desk log [--count <n>] | undo | redo  # the log, oldest first; or what was undone or redone (ADR 0077)
desk doctor --trace <file>             # a DESK_TRACE=1 trace.json: phases, totals, the five longest
desk mcp [--agent <id>] [--plugin <id>]...   # an MCP server on stdio as agent:<id> (crates/desk-mcp)
```

All but `plugin validate`, `plugin test`, `plugin list --lock`, `doctor`, `export` and `import` reach the running desk over its
socket (`crates/desk-ipc`, ADR 0030) as `cli`; `mcp` runs its client's calls as an agent (ADR 0086).
`DESK_SOCKET` names another socket. `--json` prints the answer as it came (`cmd run`, `describe`:
`cmd.answered`; `perm log`: each entry; `doctor`: JSON); `inspect` prints JSON either way. Exit codes: 0
ok; 1 a failed check or test, an invalid desk file, a refused import, a bridge error (`desk: <code>:
<message>`), a failed command or no desk at the socket; 2 usage. `plugin validate` prints `ok <id>
<version> (<kind> plugin)` or every problem. `plugin test` runs a valid plugin's tests: `tests/<name>.test.json`
on the desk-plugin-host harness for logic plugins and Wasm connectors, `tests/*.test.{js,ts}` with vitest on
the SDK's test host for the others (`packages/plugin-sdk/vitest.plugin.config.ts`, or in `DESK_REPO`).
An export is `~/.desk` with `desk.json` (`{ version: 0, os, exportedAt }`, this CLI's own manifest) at its
root and, with `--with-data`, `data/` (store, grants, settings, plugins, brain: never secrets or account).
## Testing
`cargo test -p desk-cli`: a scripted server (`socket.rs`, `perm_log.rs`, `describe.rs`, `inspect.rs`), a
real socket and `Core` (`round_trip.rs`, `fs_history.rs`, `mcp.rs`), and the rest of `tests/` on files.
