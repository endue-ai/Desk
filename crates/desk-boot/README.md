# desk-boot

The desk's composition root apart from any shell (ADR 0143): the core with its files, the start
record and safe mode (ADR 0061), crash reports, the start-up trace, the brains, the runtime's grants,
the plugins, watchers, connectors and views, the desk socket and the MCP servers. The Tauri shell and
the CEF shell (`apps/desk/shell`) both start the desk through it.

## Public API

- `boot(BootInput) -> Booted`: start the desk; `Booted` holds the core, the start, crash and trace
  state, the MCP servers, the core's addressed events for the shell to forward, and what must live.
- `events::payload(delivery)`: one `bridge://event` payload with its `to`.
- `ready::ready(status, …)`, `start::relaunch`, `Crash::record`/`take_last`, `Tracing::runtime`: what
  the runtime's own commands (`desk_ready`, `desk_relaunch`, `desk_crash`, `take_last_crash`,
  `desk_trace`) do.
- `grants::RUNTIME_CALLER` (`desk`) and `grants::grant_runtime`.

## Test

```bash
cargo test -p desk-boot
```
