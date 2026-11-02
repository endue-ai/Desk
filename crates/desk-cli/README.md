# desk-cli

The `desk` CLI: plugin validate, doctor --trace, and the commands, plugins, grants and permission log
of a running desk. The hands AI agents use. Layer: Rust core (see `docs/architecture.md`). Status: below.

## Commands

```bash
desk plugin validate <dir>             # plugin.json against specs/plugin v0; entry and view files exist
desk ping                              # a round trip to the running desk; prints ok
desk cmd list                          # id<TAB>provider<TAB>title per command
desk cmd run <id> [--args <json>]      # waits for cmd.answered; prints the result as JSON
desk plugin list                       # id<TAB>status<TAB>enabled|disabled per plugin
desk plugin enable|disable <id>        # prints ok
desk perm list                         # grantId<TAB>caller<TAB>permission per grant
desk perm revoke <grantId>             # prints ok
desk perm log [--agent <id>]           # at, caller, decision, permission, target, reason (ADR 0072)
desk doctor --trace <file>             # a DESK_TRACE=1 trace.json: phases, totals, the five longest
```

All but `plugin validate` and `doctor --trace` reach the running desk over its socket (`crates/desk-ipc`,
ADR 0030) as the caller `cli`; `DESK_SOCKET` names another socket. `--json`, anywhere among the arguments,
prints the answer as it came (`cmd run`: `cmd.answered`; `perm log`: each matching entry; `doctor`: JSON).

Exit codes: 0 ok; 1 a failed check, a bridge error (`desk: <code>: <message>` on stderr), a failed
or cancelled command, or no desk at the socket; 2 usage. `plugin validate` prints
`ok <id> <version> (<kind> plugin)` or every problem with its location, including the names the
schema cannot check (`desk_bridge::manifest_problems`: views' `$name`s and params, connector actions).

Run it from the repo with `cargo run -p desk-cli -- <command>`. CI runs `plugin validate` for every
folder with a `plugin.json` in `plugins/` and `examples/` (`.github/workflows/plugin-validate.yml`).

## Testing

```bash
cargo test -p desk-cli
```

`tests/socket.rs` and `tests/perm_log.rs` run the binary against a scripted server; `tests/round_trip.rs`
against a real `desk_ipc::Listener` and `Core`; `tests/doctor.rs` on hand-made traces.
