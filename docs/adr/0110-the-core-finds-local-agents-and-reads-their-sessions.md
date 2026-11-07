---
status: proposed
date: 2026-11-05
decision-makers: Team endue
---

# The core finds local agents and reads their sessions; Eris hands them work

## Context and Problem Statement

The person already works with Claude Code and Codex on this computer. Their sessions sit in the
programs' own files (`~/.claude/projects/*/<id>.jsonl`, `~/.codex/sessions/**/rollout-*.jsonl`, often
zstd-compressed, and `~/.codex/archived_sessions`), and the Claude app marks some Claude Code sessions
archived in its own metadata. `endue.local-agents` (ADR 0084) asks the programs from a plugin frame,
off by default, and knows nothing of those sessions. The person wants the desk to find the agents by
itself, show each one in the agent bar, show its sessions as its files say, import them (and the
archive) into the desk, hand the agent work continuing a session, and let Eris orchestrate that work.
Where does that live, and how much may it do without being asked?

## Decision Drivers

* Reading another program's files and running it are primitives: the core owns files and processes
* Finding an agent never starts it; work runs read-only unless the person allows changes
* The agent bar and Eris see the same agents, sessions and runs, whoever started a run
* No plugin needs a grant on `~/.claude` or `~/.codex`
* Session text stays on this computer and out of the log

## Considered Options

* The core serves `agents.*` (list, sessions, transcript, import, ask, runs, stop) under one
  `agents:manage` permission granted to the runtime; the shell draws it; runtime commands
  `desk.agents.*` are Eris's tools
* Grow `endue.local-agents`: grant it `fs:read` on both data folders and parse the files in its frame
* A Wasm connector that turns sessions into items in the index

## Decision Outcome

Chosen option: "the core serves `agents.*`".

* **Found by their files.** An agent is listed when its data folder or its program is there; the
  program is looked up on PATH and in the folders its installers use. Its version is the one its newest
  session recorded. Nothing runs to find it.
* **Read, not copied, until asked.** `agents.sessions` and `agents.transcript` read a bounded head and
  tail of each file, cached by size and modification time. `agents.import` copies a session and its last
  1000 turns into `<data>/agents/<agent>/<id>.json`, so it stays readable when the program drops or
  compresses its file.
* **Asked as ADR 0084 asks.** `agents.ask` runs `claude -p` or `codex exec` without a shell, continuing a
  session in its own folder, read-only unless `access: agent`. Steps go out as `agents.run`.
* **The shell registers each agent.** The agent bar lists every agent found under "This computer";
  a click opens its screen with the program's sessions, its archive and the desk's copies, Import
  sessions and Import archive, the session's turns, the work handed over and a work request.
* **Eris orchestrates through tools.** The runtime's `desk.agents.list`, `sessions`, `transcript`,
  `import`, `ask`, `dispatch` (up to four pieces of work at once) and `runs` are agent commands
  (ADR 0088), so her loop (ADR 0089) can split a task across agents and gather the answers. Work she
  hands over always runs read-only; her errands fly to the agent's screen, and the runs she started say
  so there.

### Consequences

* Good, because the agent bar shows Claude Code and Codex on first start, with no plugin to turn on.
* Good, because one permission, held by the runtime only, covers files no plugin can reach.
* Good, because a run Eris starts is the same run the person sees, stops and continues.
* Bad, because the session formats are the programs' own and undocumented; a format change empties the
  list until the readers follow. The Claude app's archive flag is read from its private metadata.
* Bad, because two paths now ask local agents: this one and `endue.local-agents` (ADR 0084, ADR 0099).
  The plugin keeps its chat, compare, board and its own ask and work tools. The agent registry (ADR 0100)
  records Eris's calls to `desk.agents.*` as runs under `desk.agents`, like any agent command, but the
  runs a person starts from the screen are not reported to it, and it does not list the agents this core
  finds; joining the two is left to a later change.
* Bad, because reading every session file on a large history costs time on the first list; the cache
  keeps later ones cheap.

## More Information

Spec: `specs/bridge/v0/agents.schema.json`, `AgentsManagePermission` in
`specs/plugin/v0/permission.schema.json`. Core: `crates/desk-core/src/local_agents/`. Runtime:
`system/local-agents.ts`, `system/local-agent-commands.ts`, `surface/local-agent/`, `shell/SideBar.ts`,
`eris/errand.ts`. Builds on ADR 0084, 0088 and 0089; sits beside ADR 0099 and 0100.
`docs/ko/desk-structure.md` should list the local agents beside the agent directory once this is accepted.
