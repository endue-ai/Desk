# desk-brain-endue

endue AI client, built only against the public `specs/brain` contract. The base URL comes from
configuration (`DESK_BRAIN_URL` in the app); in development it points at `examples/brain-echo`.

Layer: Rust core (see `docs/architecture.md`). http on std's `TcpStream`; https over rustls with the
system's roots (`ureq`, as desk-sys). endue AI gets the signed-in endue ID token (ADR 0089).

## Public API

- `HttpBrain::new(base_url)`, `with_token(token)`, `with_token_source(source)` (asked on every
  request, none while it answers `None`), `base_url()`; implements `desk_brain::Brain`.
  Connection failures and broken streams are `BrainFailure::Unreachable`; error bodies become
  `BrainFailure::Refused`.
- `http`: the transport. `Endpoint::parse` (http or https), `send(endpoint, token, method, path,
  body)`, `Response::{json, events, is_event_stream}`. One request per connection, chunked or sized
  bodies, Server-Sent Events; https goes through `tls.rs`.

## Testing

```bash
cargo test -p desk-brain-endue
cargo test -p desk-brain --test conformance --test directory   # against examples/brain-echo
```
