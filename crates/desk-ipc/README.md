# desk-ipc

The desk socket: the `desk` CLI, scripts and AI agents reach a running desk over a local socket that
only the same OS user can open (ADR 0030). Every request goes through `Core::handle` as the caller
`cli`, or as the agent the connection asked to be (ADR 0086), so the permission engine applies.

Layer: Rust core. Status: Unix sockets on macOS and Linux; Windows answers `Unsupported` for now.

## Public API

- `CALLER` (`"cli"`), `grants()`: what the app grants `cli` at start (`cmd:invoke ["*"]`,
  `plugin:manage`, `perm:manage`, `log:read`, `update:manage`, and `fs:read` and `fs:write` over
  `/**` and `~/**` for `desk fs`, ADR 0076).
- `socket_path()`: `DESK_SOCKET`, or `desk.sock` in the data folder (`ai.endue.desk` under
  `dirs::data_dir()`, the folder Tauri's `app_data_dir()` names).
- `Listener::bind(&path, Arc<Core>)`: bind (a stale file is replaced; a live desk gives `AddrInUse`),
  mode 0600, serve every connection on its own threads; dropping it removes the file.
- `Client::connect(&path)`, `call(BridgeRequest)`, `next_event()`, `call_line` / `next_event_line`
  (the line as it came; events that arrive during a call are kept) and `become_agent(id, agent)`.

## Wire

One compact JSON document per `\n`-terminated UTF-8 line; no handshake, version line or wrapper.

- In: a `BridgeRequest` (`specs/bridge/v0`). Out: its `BridgeResponse`, and every core `BridgeEvent`
  (`{event, data}`); a reader tells them apart by `id` versus `event`.
- A line that is not a `BridgeRequest` is answered `invalid_params` with its `id`, or `0` when the id
  cannot be read; the connection stays open. Empty lines are ignored. Clients count ids from 1.
- `AGENT_METHOD`, the socket's own `{ id, method: "socket.agent", params: { agent } }`, answers
  `{ caller: "agent:<agent>" }`: from then on the agent's grants, allowlist, prompts and approvals
  apply (ADR 0072, 0078), as for `desk mcp`. Only a `cli` connection may ask; an agent stays one.
- Requests on one connection are answered in order; connections run in parallel. A client that lets
  1000 lines queue up is dropped: the desk never waits on a client.

## Testing

`cargo test -p desk-ipc`: `tests/socket.rs` puts an in-process `Core` behind the socket and speaks raw
lines (Unix only); `tests/agent.rs` covers agent connections; `tests/grants.rs` the grants and the
socket path.
