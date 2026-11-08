# desk-brain-local

Local brain adapter: `LocalBrain` implements `desk_brain::Brain` on Ollama's `/api/chat` (streamed), so a
desk works without endue AI (the app's `local` brain and its offline fallback, ADR 0094), or on the
person's own Claude Code, asked without its tools (the `claude` brain, ADR 0109).

Layer: Rust core (see `docs/architecture.md`). Contract: `specs/brain/v0`.

## Public API

- `LocalBrain::open(folder, options)`: Ollama. State (sessions, leases, conversations) lives in
  `folder/STATE_FILE` (`local-brain.json`), written through a temporary file on every change.
  `with_clock(ms)` replaces the system clock, for tests.
- `LocalBrainOptions::new(model)`: `base_url` (`DEFAULT_BASE_URL`, `http://127.0.0.1:11434`), the
  `tools` offered to the model, in Ollama's format, and the `agent` its tool calls speak for, so the
  desk runs them as `agent:<id>` (ADR 0072, 0088); without one they are Eris's.
- `LocalBrain::claude_code(folder, ClaudeCodeOptions::new(program))` (`with_model`, `with_timeout`):
  each answer is one `claude -p --tools "" --safe-mode --strict-mcp-config --no-session-persistence`
  run in `folder`; the turn's tools go in the system prompt, the answer comes back through
  `--json-schema` (`say` or `calls`), the conversation goes on stdin. `find_claude(PATH, home)`.
- `Brain` methods: turns stream `turn.started`, `text.delta`, `tool.call` and `turn.completed`. A
  turn's `context` (ADR 0096) goes to the model as one system message for that turn only.
  Tool calls go out one at a time; once every result is in, they go back to the model.
- Leases follow `examples/brain-echo`: `lease_held`, `lease_lost` after a takeover, `lease_expired`.
- `list_spaces` answers no spaces once the model answers (`/api/version`, `claude --version`).
- Failures: no connection, a stream cut short, Claude Code missing, offline or overloaded →
  `Unreachable`; an error status → `Refused` (429 `rate_limited`, otherwise as the status says); output
  that is not the model's JSON → `Protocol`.

The transport is std's `TcpStream` (`src/http.rs`) and `std::process`; there are no HTTP crates.

## Testing

```bash
cargo test -p desk-brain-local
cargo test -p desk-brain-local --test claude_code -- --ignored   # the installed Claude Code
```

A fake Ollama on std's `TcpListener` and a fake `claude` script (Unix) stand in for the models; every
event, session and lease is checked against `desk_brain::BRAIN_SCHEMA_JSON`.
