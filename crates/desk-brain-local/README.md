# desk-brain-local

Local brain adapter: `LocalBrain` implements `desk_brain::Brain` on Ollama's `/api/chat` (streamed), so a
desk works without endue AI. llama.cpp comes later.

Layer: Rust core (see `docs/architecture.md`). Contract: `specs/brain/v0`.

## Public API

- `LocalBrain::open(folder, options)`: state (sessions, leases, conversations) lives in
  `folder/STATE_FILE` (`local-brain.json`), written through a temporary file on every change.
  `with_clock(ms)` replaces the system clock, for tests.
- `LocalBrainOptions::new(model)`: `base_url` (`DEFAULT_BASE_URL`, `http://127.0.0.1:11434`) and the
  `tools` offered to the model, in Ollama's format (`with_base_url`, `with_tools`).
- `Brain` methods: turns stream `turn.started`, `text.delta`, `tool.call` and `turn.completed`.
  Tool calls go out one at a time; once every result is in, they go back to the model.
- The agent directory is empty: `list_agents`, `list_spaces` and `list_a2a_tasks` answer empty pages
  (page from 1, limit 1 to 100, else `invalid_request`), `get_agent_card` answers 404 `not_found`.
- Leases follow `examples/brain-echo`: `lease_held`, `lease_lost` after a takeover, `lease_expired`.
- Failures: no connection or a stream cut short → `Unreachable`; an error status or `{"error"}` →
  `Refused` (404 `not_found`, 400 `invalid_request`, otherwise `internal`); a line that is not
  Ollama's JSON → `Protocol`.

The transport is std's `TcpStream` (`src/http.rs`), plain http only; there are no HTTP crates.

## Testing

```bash
cargo test -p desk-brain-local
```

The tests run a fake Ollama on std's `TcpListener` (no model needed) and check every event, session
and lease against `desk_brain::BRAIN_SCHEMA_JSON`.
