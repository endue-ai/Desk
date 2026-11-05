# desk-mcp

An MCP server for the running desk (ADR 0086): Claude Code, Claude Desktop, an IDE or any MCP client
starts `desk mcp` and reaches every plugin through the desk socket (`crates/desk-ipc`). Layer: Rust core.

## Tools and resources

- `list-plugins`, `list-commands`: every plugin with the commands it provides now, args schemas, which
  are `irreversible`; filter by plugin or words. Read as `cli`.
- `run-command`: run any plugin's command and wait for its answer. `call-bridge`: any bridge method
  (`data.query`, `catalog.get`, `fs.read`...), with `params.scope` where `specs/bridge/v0` asks for one.
- `--plugin <id>` (repeatable, `*` for all, `desk` for the runtime's): a tool per command, named after
  its id with dots as underscores (`endue_git_status`), its args schema as input.
- Resources `desk://plugins` and `desk://plugins/<id>`; `list_changed` when commands or plugins change.

Every call runs as `agent:<id>` (`--agent`, default `mcp`): the first use asks the person in Desk, an
irreversible one waits for approval, `agents.<id>.allow` in init.yaml caps it, and
`desk perm log --agent <id>` shows it.

## Public API

`serve(input, output, Options { agent, plugins, socket })`, `Options::default()`, `PROTOCOL_VERSIONS`
(2025-11-25 back to 2024-11-05), `SERVER_NAME`, `DEFAULT_AGENT` and the four tool names.

## Use it

```bash
cargo install --path crates/desk-cli --locked      # puts desk on PATH
claude mcp add desk -- desk mcp --agent claude-code --plugin endue.git
```

Other clients: `{ "mcpServers": { "desk": { "command": "desk", "args": ["mcp", "--agent", "ide"] } } }`.

## Testing

`cargo test -p desk-mcp`: `tests/protocol.rs` (handshake, JSON-RPC errors, no desk), `tests/tools.rs` and
`tests/changes.rs` on a real `Core` behind a real socket with two plugins.
