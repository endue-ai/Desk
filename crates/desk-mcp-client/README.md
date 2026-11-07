# desk-mcp-client

Desk as an MCP client (ADR 0098): the MCP servers a person lists in init.yaml (`mcp.servers`) start
over stdio, each as the caller `mcp:<name>`, and every tool becomes the agent command
`mcp.<name>.<tool>` (ADR 0088). Layer: Rust core. In process for now; the VM (ADR 0002) comes later.

## Public API

- `Host::attach(&core, configs(&core.init()), home)`: one thread per server. It asks `perm.request`
  for `proc:spawn` of the command (for always), starts the server, registers its tools, answers each
  `cmd.invoked` with a tool call, registers again on `tools/list_changed`, and stops when the grant is
  revoked, the server exits or the host is dropped. Its stderr and what happens go to `log.write`.
- `Server::spawn`: the process with a cleared environment: the MCP SDKs' defaults (HOME, LOGNAME,
  PATH, SHELL, TERM, USER; the Windows set) plus the variables `env` names. `stop` closes, waits, kills.
- `Connection` (JSON-RPC over newline-delimited JSON) and `Session` (`initialize` in 2024-11-05 to
  2025-11-25, `tools/list` pages, `tools/call`). The client answers `ping` and declares no capabilities.
- `tools::commands`: tool → `cmd.register` params (ids, read-only from `readOnlyHint`, the input
  schema when it compiles); `tools::answer`: a result → `cmd.answer` params, `isError` a failure.

The core makes an `mcp:` provider's commands irreversible unless read-only, and keeps it to its own ids
(`crates/desk-core/src/core_tools.rs`). The app attaches the servers at the first ready line
(`apps/desk/src-tauri/src/mcp.rs`).

## Tests

```bash
cargo test -p desk-mcp-client
```

`tests/fixture/server.rs` is a small MCP server, built as the `desk-mcp-fixture` binary for the tests
only. `tests/session.rs` drives it over stdio; `tests/core.rs` attaches it to a real `Core`: tools in
`cmd.tools`, an agent's call round trip, a refused grant, a revoke and a changed tool list.
