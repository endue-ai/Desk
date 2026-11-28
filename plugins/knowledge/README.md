# plugins/knowledge

`endue.knowledge`: a knowledge base from the sessions Claude Code and Codex keep on this computer. The
built-in connector `desk.agent-sessions` (ADR 0403) reads them, read-only, into the item index; this
plugin links them by the files, tickets, pull requests, ADRs and branches they share (ADR 0404). Three
views: **Graph** (sessions coloured by agent, things sized by how many sessions touched them, hubs as
filters), **Around** (what lies within two links of the selection) and **Note**. Beside them: filters by
agent, kind and repository, the selection's details (what came up with it, its sessions, sessions alike),
sessions by day, search. Nothing is read until the person presses **Read agent sessions**. It autoloads:
`endue.knowledge.open` opens it (`desk.plugins.open`). At the desk's first window size (400×263) the
graph stands alone and the filters and the details lie over it; every control is a `base.css` kit one.

| Permission | Why |
| --- | --- |
| `data:read` (`record` from `desk.agent-sessions`) | The session items, and full-text search over them |
| `connector:manage` | Connect and sync `desk.agent-sessions` |
| `fs:write` (`~/.desk/knowledge/**`) | Notes: Markdown linked as `[[name]]` wiki links |
| `cmd:invoke` (`desk.files.open`) | Open a note in the desk |

Agent tools (ADR 0088), read-only: `endue.knowledge.search`, `endue.knowledge.related` (the sessions of a
file, ticket or pull request and what came up with it) and `endue.knowledge.note`. Settings:
`endue.knowledge.ignore` (`AC`), `endue.knowledge.hub` (5 %), `endue.knowledge.shared` (2).

| File | Purpose |
| --- | --- |
| `ui/graph.js`, `query.js` | The graph from the items, weights and hubs; what is drawn, around, together, alike, search |
| `ui/notes.js`, `model.js` | Notes; the details, the days and the counts the page shows |
| `ui/layout.js`, `worker.js`, `layout-client.js` | Barnes–Hut force layout in a worker |
| `ui/scene.js`, `canvas.js`, `stage.js` | Nodes and edges to draw; drawing with theme tokens; pan, zoom, pick |
| `ui/plugin.js`, `commands.js` | The controller and the `endue.knowledge.*` commands |
| `ui/view.js`, `rail.js`, `panel.js`, `dom.js` | The page: bar, filters, details and days |
| `ui/main.js`, `style.css` | Mounting (only `main.js` imports the SDK); layout over tokens and `base.css` |

```bash
pnpm exec vitest run plugins/knowledge
cargo run -p desk-cli -- plugin validate plugins/knowledge
```
