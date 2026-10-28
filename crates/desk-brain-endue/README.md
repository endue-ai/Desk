# desk-brain-endue

endue AI client, built only against the public `specs/brain` contract. The base URL comes from
configuration (`DESK_BRAIN_URL` in the app); until endue AI is connected it points at
`examples/brain-echo`.

Layer: Rust core (see `docs/architecture.md`). Status: plain http only; TLS and endue ID tokens arrive
with the real endue AI.

## Public API

- `HttpBrain::new(base_url)`, `with_token(token)`, `base_url()`; implements `desk_brain::Brain`.
  The agent directory (`list_agents`, `list_spaces`, `list_space_agents`) goes to endue AI's API
  gateway (`/api/v1/...`) with the same token: `with_gateway(url)`, `gateway_url()`; by default the
  base URL's origin (`http://127.0.0.1:8787/v0` gives `http://127.0.0.1:8787`). A gateway 401 without
  a `BrainError` body becomes `Refused` with `unauthorized`.
  Connection failures and broken streams are `BrainFailure::Unreachable`; error bodies become
  `BrainFailure::Refused`.
- `http`: the transport, std only. `Endpoint::parse`, `send(endpoint, token, method, path, body)`,
  `Response::{json, events, is_event_stream}`. One request per connection, chunked or sized bodies,
  Server-Sent Events.

## Testing

```bash
cargo test -p desk-brain-endue
cargo test -p desk-brain --test conformance --test directory   # against examples/brain-echo
```
