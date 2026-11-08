# desk-platform

The client of endue AI's platform API subset that Desk calls (`specs/platform/v0`, ADR 0122): the
person's endue AI agents, what Studio shows of one, the agent catalog and the Home board's
conversations. desk-core serves it on the bridge as `studio.*`.

## Public API

- `Platform::new(base_url, tokens)`, `Platform::from_env(tokens)`: the base is `https://platform.endue.ai`
  unless `DESK_ENDUE_PLATFORM_URL` names another; `with_timeout` changes the 15 s deadline.
- `Tokens`: where the bearer token comes from (`token`) and the one retry after a 401 (`refresh`).
- Agents: `list_agents` (every page, deleted ones left out), `list_agents_page`, `get_agent`,
  `create_agent`, `update_agent`, `set_status` (`Switch`), `delete_agent` (soft).
- Facets: `identity`, `settings`, `update_settings`, `prompt`, `save_prompt`, `restore_prompt`,
  `prompt_revisions`, `skills`, `connectors`, `traits`.
- Catalog and conversations: `catalog`, `recommend`, `use_catalog` (30 s), `conversations`.
- `PlatformError { kind, status, code, message }` with `ErrorKind`: `SignedOut`, `Offline`,
  `Forbidden`, `NotFound`, `Invalid`, `Conflict`, `Failed`.
- `wire`, `wire_catalog`: the platform's bodies, snake_case, read tolerantly (unknown fields ignored,
  `null` read as absent).
- `fake::FakePlatform` (feature `fake`, tests only): the platform on 127.0.0.1, in memory.

Requests go over desk-sys's fetch: rustls, the system proxy, and a host allowlist of the base's
host alone. No Origin header is sent.

## Test

```bash
cargo test -p desk-platform
```

`tests/agents.rs` runs the client against the fake; `tests/contract.rs` judges the contract's vectors
and checks the bodies the client sends against it. No test leaves this machine.
