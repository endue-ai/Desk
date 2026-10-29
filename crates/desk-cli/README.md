# desk-cli

The `desk` CLI: plugin validate, and the commands, plugins and grants of a running desk. The hands AI
agents use.

Layer: Rust core (see `docs/architecture.md`). Status: the commands below.

## Commands

```bash
desk plugin validate <dir>             # plugin.json against specs/plugin v0, and the entry exists
desk ping                              # a round trip to the running desk; prints ok
desk cmd list                          # id<TAB>provider<TAB>title per command
desk cmd run <id> [--args <json>]      # waits for cmd.answered; prints the result as JSON
desk plugin list                       # id<TAB>status<TAB>enabled|disabled per plugin
desk plugin enable|disable <id>        # prints ok
desk perm list                         # grantId<TAB>caller<TAB>permission per grant
desk perm revoke <grantId>             # prints ok
```

All but `plugin validate` reach the running desk over its socket (`crates/desk-ipc`, ADR 0030) as
the caller `cli`; `DESK_SOCKET` names another socket. `--json`, anywhere among the arguments, prints
the desk's answer line as it came (for `cmd run`, the `cmd.answered` event line).

Exit codes: 0 ok; 1 a failed check, a bridge error (`desk: <code>: <message>` on stderr), a failed
or cancelled command, or no desk at the socket; 2 usage. `plugin validate` prints
`ok <id> <version> (<kind> plugin)` or every problem with its location.

Run it from the repo with `cargo run -p desk-cli -- <command>`. CI runs `plugin validate` for every
folder with a `plugin.json` in `plugins/` and `examples/` (`.github/workflows/plugin-validate.yml`).

## Testing

```bash
cargo test -p desk-cli
```

`tests/socket.rs` runs the binary against a scripted server; `tests/round_trip.rs` against a real
`desk_ipc::Listener` and `Core`.
