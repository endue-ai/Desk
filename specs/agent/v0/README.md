# Desk agent v0

One record for every agent the desk knows (ADR 0100): Eris, the agents init.yaml names, agents that call
the desk as `agent:<id>` (the brain's agents, apps over MCP), agents of the brain's directory and the
programs a plugin runs on this computer (the local agents). `agent.schema.json` is `AgentRecord`; the
bridge lists them with `agent.list` (`specs/bridge/v0/agent.schema.json`). v0 may break on any minor
release (ADR 0004).

| Field | Meaning |
| --- | --- |
| `id` | `eris`, the id of an `agent:<id>` caller or of the directory, or `<plugin>/<id>` for an agent a plugin runs |
| `name`, `colour?` | What people see |
| `source` | `eris`, `init`, `caller`, `directory` or `local` |
| `caller?` | `agent:<id>`, when it calls the desk |
| `brain?` | What thinks for it, in a word: `endue`, `local`, `echo`, `claude` |
| `tools?`, `grants?` | The commands it may be granted (its allowlist's, else its grants'), and what it holds now |
| `state` | `waiting` (a run waits for approval) over `working` (a run runs) over `error` (its last run failed) over `idle` |
| `runs?` | Runs seen since the desk started |

The registry is computed when asked, never stored. What an agent does is a run: an item of kind `run`
(`specs/item/v0`) with its agent, state, start, end and a short result, so every view can draw runs.

`vectors/` holds valid and invalid records for the contract tests.
