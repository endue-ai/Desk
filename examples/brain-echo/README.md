# examples/brain-echo

The smallest implementation of `specs/brain/v0/openapi.yaml`: sessions, streamed turns (Server-Sent
Events), tool calls, session leases and a fixed agent directory. Node's standard library, in memory.

```bash
just brain-echo                                  # or: node examples/brain-echo/server.mjs
node examples/brain-echo/server.mjs --port 0     # a free port; the first line printed has the URL
```
It listens on `http://127.0.0.1:8787/v0`, where Desk's echo brain looks (`DESK_ECHO_URL`, ADR 0094).

| Message | Answer |
| --- | --- |
| anything | the same text, one `text.delta` per word |
| `tool: <text>` | "Let me ask the echo tool.", a `tool.call` to `echo` with `{ "text": <text> }`, a stop at `tool_call`; after the result, "The echo tool said: <text>" |
| `tool <name> as <agent>: <json>` | the same for the tool `<name>` with the JSON object as arguments and `agentId: <agent>` (without `as <agent>`, no `agentId`); after the result, "The <name> tool said: <output>" or "failed: <output>" |
| several `tool ...` calls, one per line or joined by ` then ` | one turn that asks for each tool in order: after each result it says what the tool said and asks for the next |
| any, with `tools` | a `tool.call` to the tool `toolChoice` names, or to the first one offered it knows (`echo`, `propose_theme`, `propose_universal_view`), and a stop at `tool_call`; other tools get words |
| a local agent's name (Claude, Codex, Gemini, Grok, Qwen, Copilot, Cursor, OpenCode) when `endue_local-agents_ask` is offered | Eris hands work to a local agent (ADR 0099): a `tool.call` to it with `{ agent, prompt }`, the whole message as the prompt; after the result, "The <name> tool said: <output>" |
| words that name an offered command | Eris's loop (ADR 0089): a `tool.call` with `{}` to the command tool whose name's words after the first are all in the message ("check my latest mail" calls `endue_mail_latest`); after the result, "The <name> tool said: <output>", the output's `text` when it has one |
| `remember that <fact>` with `desk-remember` offered | Eris keeps a fact (ADR 0096): a `tool.call` to `desk-remember` with `{ text: <fact> }`; a turn's `context` is accepted and not used |

`propose_theme` (`theme.mjs`) answers `{ name, description, theme }` from the words in the message's last
line, English or Korean: warm, amber, ocean, forest and pastel pick the colours; night, paper, grain, glass
and terminal the rest (따뜻, 호박, 바다, 숲, 파스텔, 밤, 종이, 질감, 유리, 터미널 too). `propose_universal_view`
(`universal.mjs`) answers a universal view from the sentence in the prompt's first quotes: board, timeline,
calendar, chat, document or run its type; a URL, a data file, a folder or item kinds (issues, events,
notes, …) its source. "show this repo's issues as a board" is a kanban over task items.

Leases follow the contract: `lease_held` when another desk has the session, `takeover` ends it (its holder
gets `lease_lost`), a lease past `expiresAt` is `lease_expired`. Any bearer token is accepted.

The directory is fixed sample data: `GET /spaces` (Home, Studio), `GET /agents` (Mira, Theo, Juno inactive;
Kai, Lena), `GET /agents/{agentId}/card`, `GET /a2a/tasks` (four hand-overs). Lists filter by `spaceId`,
`targetAgentId` and `status`, newest first, paged by `page` and `limit` (1 to 100, default 20).

`BRAIN_ECHO_DELAY_MS` (40) paces events; `BRAIN_ECHO_SECOND_MS` (1000) is a lease second in ms (tests: 20).
`brain.mjs` is the state machine, `theme.mjs` and `universal.mjs` the tools, `directory.mjs` the directory,
`server.mjs` the HTTP. Tests: `cargo test -p desk-brain --test conformance --test directory -p desk-core
--test brain_ask`; `universal.mjs` in `packages/runtime/src/propose/universal-echo.test.ts`; `tests/`.
