# desk-brain-endue

endue AI client, built only against the public `specs/brain` contract. The base URL comes from
configuration (`DESK_BRAIN_URL` in the app); until endue AI is connected it points at
`examples/brain-echo`.

Layer: Rust core (see `docs/architecture.md`). Status: plain http only; TLS and endue ID tokens arrive
with the real endue AI.

## Public API

- `HttpBrain::new(base_url)`, `with_token(token)`, `base_url()`; implements `desk_brain::Brain`.
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
