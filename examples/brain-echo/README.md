# examples/brain-echo

The smallest implementation of `specs/brain/v0/openapi.yaml`: sessions, streamed turns (Server-Sent
Events), tool calls, session leases and a fixed agent directory. Node's standard library, in memory.

```bash
just brain-echo                                  # or: node examples/brain-echo/server.mjs
node examples/brain-echo/server.mjs --port 0     # a free port; the first line printed has the URL
```
It listens on `http://127.0.0.1:8787/v0`, which is where Desk looks by default (`DESK_BRAIN_URL`).

| Message | Answer |
| --- | --- |
| anything | the same text, one `text.delta` per word |
| `tool: <text>` | "Let me ask the echo tool.", a `tool.call` to `echo` with `{ "text": <text> }`, a stop at `tool_call`; after the result, "The echo tool said: <text>" |
| `tool <name> as <agent>: <json>` | the same for the tool `<name>` with the JSON object as arguments and `agentId: <agent>` (without `as <agent>`, no `agentId`); after the result, "The <name> tool said: <output>" or "failed: <output>" |
| several `tool ...` calls, one per line or joined by ` then ` | one turn that asks for each tool in order: after each result it says what the tool said and asks for the next |
| any, with `tools` | a `tool.call` to the tool `toolChoice` names, or to the first one offered it knows (`echo`, `propose_theme`, `propose_universal_view`), and a stop at `tool_call`; other tools get words |

`propose_theme` (`theme.mjs`) answers `{ name, description, theme }` from the words in the message's last
line, English or Korean: warm, amber, ocean, forest and pastel pick the colours; night, paper, grain, glass
and terminal the rest (따뜻, 호박, 바다, 숲, 파스텔, 밤, 종이, 질감, 유리, 터미널 too). `propose_universal_view`
(`universal.mjs`) answers a universal view from the sentence in the prompt's first quotes: board, timeline,
calendar, chat, document or run its type; a URL, a data file, a folder or item kinds (issues, events,
notes, …) its source. "show this repo's issues as a board" is a kanban over task items.

Leases follow the contract: `lease_held` (with the holder) when another desk has the session, `takeover`
ends that lease and its holder gets `lease_lost`, a lease past `expiresAt` gives `lease_expired`. Any bearer
token is accepted.

The directory is fixed sample data: `GET /spaces` (Home, Studio), `GET /agents` (Mira, Theo, Juno inactive;
Kai, Lena), `GET /agents/{agentId}/card`, `GET /a2a/tasks` (four hand-overs). Lists filter by `spaceId`,
`targetAgentId` and `status`, newest first, paged by `page` and `limit` (1 to 100, default 20).

`BRAIN_ECHO_DELAY_MS` (default 40) is the pause between events, `BRAIN_ECHO_SECOND_MS` (default 1000) the
real milliseconds in one lease second (the tests use 20).

`brain.mjs` is the state machine, `theme.mjs` and `universal.mjs` the tools, `directory.mjs` the directory,
`server.mjs` the HTTP. Tests: `cargo test -p desk-brain --test conformance --test directory -p desk-core
--test brain_ask`; `universal.mjs` in `packages/runtime/src/propose/universal-echo.test.ts`.
