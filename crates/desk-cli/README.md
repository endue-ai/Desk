# desk-cli

The `desk` CLI: plugin validate and test, and the commands, plugins and grants of a running desk.
The hands AI agents use. Layer: Rust core (see `docs/architecture.md`).

## Commands

```bash
desk plugin validate <dir>             # plugin.json against specs/plugin v0; entry and view files exist
desk plugin test <dir>                 # the folder's tests/ on the host for its kind
desk ping                              # a round trip to the running desk; prints ok
desk cmd list                          # id<TAB>provider<TAB>title per command
desk cmd run <id> [--args <json>]      # waits for cmd.answered; prints the result as JSON
desk plugin list                       # id<TAB>status<TAB>enabled|disabled per plugin
desk plugin enable|disable <id>        # prints ok
desk perm list                         # grantId<TAB>caller<TAB>permission per grant
desk perm revoke <grantId>             # prints ok
```

All but `plugin validate` and `plugin test` reach the running desk over its socket (`crates/desk-ipc`,
ADR 0030) as the caller `cli`; `DESK_SOCKET` names another socket. `--json` prints the desk's answer
line as it came (for `cmd run`, the `cmd.answered` event line). Exit codes: 0 ok; 1 a failed check
or test, a bridge error (`desk: <code>: <message>` on stderr), a failed or cancelled command, or no
desk at the socket; 2 usage. `plugin validate` prints `ok <id> <version> (<kind> plugin)` or every
problem, including the names the schema cannot check (`desk_bridge::manifest_problems`).

`plugin test` runs on a plugin that validates. Logic plugins and Wasm connectors: each
`tests/<name>.test.json` on the desk-plugin-host harness, `ok <name>` or `FAILED <name>` (why on
stderr), then `<n> passed, <m> failed`. Other kinds: `tests/*.test.{js,ts}` with vitest on the
SDK's test host (`packages/plugin-sdk/vitest.plugin.config.ts`, jsdom), with `node` and the Desk
checkout the binary was built in (`DESK_REPO` names another). Tool and MCP plugins: none yet.

Run it from the repo with `cargo run -p desk-cli -- <command>`. CI validates every plugin folder in
`plugins/` and `examples/` (`.github/workflows/plugin-validate.yml`).

## Testing

`cargo test -p desk-cli`: `tests/socket.rs` against a scripted server, `tests/round_trip.rs` against a
real `desk_ipc::Listener` and `Core`, `tests/plugin_test.rs` and `tests/templates.rs` (every
create-plugin kind scaffolded, built, validated and tested; needs `node` and `pnpm install`).
