---
status: accepted
date: 2026-11-05
decision-makers: Team endue
---

# Eris asks local agents read-only and hands them work only with approval

## Context and Problem Statement

The local-agents plugin runs the agent programs on the person's computer (Claude Code, Codex and
others, ADR 0084), but only for the person: none of its commands was offered to agents, so Eris could
not hand a job to Claude or Codex and bring the answer back (roadmap milestone M2, killer feature 2,
ADR 0093). Its access setting decides whether a program runs read-only or with its own permissions,
for every run. An agent command's `readOnly` and `irreversible` are fixed in the manifest (ADR 0088,
0078), so one command cannot be read-only under one setting and acting under the other. Which
commands does the plugin offer, and how does a call that lets a program change files reach the
person first?

## Decision Drivers

* Asking must be free and safe: Eris should be able to ask a local agent without a prompt every time
* Anything that may change files or run commands waits for the person (ADR 0078)
* The flags are the manifest's and static; the setting must not quietly widen a read-only command
* A program works where the person said: the work folder, or a folder inside it
* No new bridge method and nothing new in the core

## Considered Options

* Two commands: `ask`, always read-only (`readOnly`), and `work`, with agent access (`irreversible`)
* One `ask` that follows the access setting, marked `irreversible`
* One `ask` that follows the access setting, marked `readOnly`

## Decision Outcome

Chosen option: "two commands", because each flag then tells the truth whatever the setting: `ask`
never lets a program act, so Eris asks freely; `work` always may, so every agent's call of it waits for
the person's approval with the prompt shown. One irreversible `ask` would put an approval in front of
every question; one read-only `ask` that follows the setting would let a program change files under a
read-only flag.

* **Offered to agents:** `endue.local-agents.list` (read-only), `ask` (read-only, read-only access
  whatever the setting), `work` (irreversible, agent access) and `add-card` (puts a task in To do).
* **The folder:** `ask` and `work` take `folder`, relative to the work folder
  (`endue.local-agents.folder`, home when empty). An absolute path, `~`, a drive or `..` is refused.
* **The board:** `add-card` no longer takes `run`, so an agent can put a task on the board but not
  start it; running a card stays the person's (it follows the access setting, as before).
* **The setting** keeps deciding the person's own chat, compare and board runs.
* **ADR 0072 and 0078** become accepted: agents are callers with their own grants, and their
  irreversible calls wait for approval. This relies on both.

### Consequences

* Good, because "ask Claude to run this repo's tests" goes from Eris to Claude Code and back as an
  errand (ADR 0089), with no prompt for a question and an approval for real work.
* Good, because the plugin needs only manifest fields and a command, no core change.
* Bad, because a program with no read-only mode (Grok CLI, Cursor Agent, OpenCode) is still asked
  through the plugin's once-per-session confirmation, not an approval: read-only is only as strong
  as each program's mode (ADR 0084).
* Bad, because the person loses `add-card`'s `run` shortcut through `cmd.invoke`; the view's buttons
  still add and run.
* Bad, because a `work` approval shows the prompt and the folder, not what the program will do.

## More Information

Issue #469. Code: `plugins/local-agents/ui/schemas.js`, `commands.js`, `talk.js`, `settings.js`
(`inside`), `plugin.json`; `crates/desk-core/tests/local_agent_tools.rs`; brain-echo's call in
`examples/brain-echo/brain.mjs`. Builds on ADR 0072, 0078, 0084, 0088 and 0089.
