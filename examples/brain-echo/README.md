# examples/brain-echo

The smallest implementation of `specs/brain/v0/openapi.yaml`: sessions, streamed turns (Server-Sent
Events), one tool round trip, session leases and the gateway's agent directory. Node's standard
library only, state in memory.

```bash
just brain-echo                                  # or: node examples/brain-echo/server.mjs
node examples/brain-echo/server.mjs --port 0     # a free port; the first line printed has the URL
```

It listens on `http://127.0.0.1:8787/v0`, which is where Desk looks by default (`DESK_BRAIN_URL`).

| Message | Answer |
| --- | --- |
| anything | the same text, one `text.delta` per word |
| `tool: <text>` | "Let me ask the echo tool.", a `tool.call` to `echo` with `{ "text": <text> }`, a stop at `tool_call`; after the result, "The echo tool said: <text>" |

Leases follow the contract: `lease_held` (with the holder) when another desk has the session,
`takeover` ends that lease at once and its holder then gets `lease_lost`, and a lease past `expiresAt`
gives `lease_expired`. Any bearer token is accepted.

Beside the brain, it serves endue AI's API gateway paths at its root, with fixed sample data (so
answers never change) in the gateway's snake_case shape. `GET /api/v1/agents`: Mira, Theo, Juno
(inactive), Kai and Lena, newest first; like the agent service, `page` is at least 1 and `limit` is
lowered or raised to 1 to 50 (default 20), never refused. `GET /api/v1/spaces`: Home and Studio, as a
plain array. `GET /api/v1/spaces/{spaceId}/agents`: Mira, Theo and Juno in Home, Kai and Lena in
Studio, Mira and Kai at the front, in the `data`/`meta` envelope; an unknown space is `not_found`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `BRAIN_ECHO_DELAY_MS` | 40 | pause between streamed events |
| `BRAIN_ECHO_SECOND_MS` | 1000 | real milliseconds in one lease second (the tests use 20) |

`brain.mjs` holds the state machine and `directory.mjs` the gateway's directory; `server.mjs` carries
both over HTTP. Conformance: `cargo test -p desk-brain --test conformance --test directory`.
