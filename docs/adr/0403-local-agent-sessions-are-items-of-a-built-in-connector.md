---
status: accepted
date: 2026-11-28
decision-makers: Team endue
---

# Local agent sessions are items of a built-in connector

## Context and Problem Statement

The core finds Claude Code and Codex and reads their sessions (ADR 0110): `agents.sessions` lists them
from a bounded head and tail of each file, `agents.transcript` reads one, and `agents:manage` is the
runtime's, a plugin getting it only by asking the person (ADR 0112). A knowledge base built from those
sessions needs every session read whole, once, with what it touched pulled out: the files it changed or
read, the tickets, pull requests, issues and ADRs it named, its branch, its repository, the session that
started it. A month of daily use is well over a thousand transcripts, most of them subagents, and
gigabytes of JSON lines. The knowledge base only reads, while `agents:manage` also runs the programs
(`agents.ask`), and the palette, views and agents should find sessions too. Where do the sessions and
their links live, and what is kept of them?

## Decision Drivers

* Read-only: the programs own their folders; nothing is written or moved there (ADR 0110)
* The same agents and folders as `agents.*` (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, compressed `.jsonl.zst`)
* Nothing leaves the computer, and secrets in transcripts never reach the index
* A 200 MB transcript is read without holding it, and a sync reads only what changed
* Injected context (CLAUDE.md, system reminders, skill text) never counts as what the person said:
  otherwise the tickets it names show up in every session of a repository
* One shape for every program, so no consumer parses a program's format

## Considered Options

* A built-in connector `desk.agent-sessions` over a crate `desk-sessions`, writing items to the index
* More `agents.*` methods that answer the links, behind `agents:manage`
* A Wasm connector plugin (ADR 0034)

## Decision Outcome

Chosen option: "a built-in connector", because items in the index reach every app through `data:read`
and are searched in full text, while `agents.*` keeps to listing, continuing and running sessions. A
Wasm connector does not fit this data: each call has one second and 64 MiB, `fs.read` returns a whole
file, a store value holds 64 KiB, and a grant prompt during a sync outlives the call.

`crates/desk-sessions` reads the transcripts line by line on up to eight threads, decompressing `.zst`
files as it goes; lines it never needs (tool output, attachments, reasoning, token counts) are skipped by
their type before they are parsed. Each transcript becomes one `record` item of
`specs/item/v0/agent-session.schema.json`: who ran it, where (`cwd`, and `repo` with
`.claude/worktrees/<name>` or `.worktrees/<name>` folded away), its parent for a subagent, and its links, each with a relation,
where a mention was found and how often. The body is what the person asked and the last answer,
injected blocks removed, secrets masked by shape and by name, 16,000 characters at most. Approval
guardian sessions, which the harness runs for itself, are left out. desk-core lists the connector with
the calendar built-ins when it has local agents (`with_agent_sessions` after `with_local_agents`, so the
folders are theirs): one instance, no settings, a sync every five minutes; connecting it is the person's
consent. What the last sync read (size, change time, item id, thread name per transcript) is kept in
`agent-sessions.json` in the data folder; when the index and that record disagree, everything is read
again.

### Consequences

* Good, because a first read of gigabytes takes seconds, and a sync with nothing new takes milliseconds.
* Good, because every consumer reads one schema; Hermes or another program adds an adapter, not a shape.
* Good, because the palette, views and agents find sessions by what was asked, through the index.
* Bad, because two readers of the same files now exist: `agents.*` lists and continues sessions, this
  one links them. A format change has to reach both.
* Bad, because the folders read are fixed in code, not limited by a sandbox and a grant; the crate reads
  only under the programs' folders and follows no links.
* Bad, because the schema names a third program, `hermes`, that nothing reads yet; its adapter waits
  for an install to check against.

## More Information

The knowledge app built on these items: ADR 0404. Builds on ADR 0033 (the index), ADR 0110 (local agents).
