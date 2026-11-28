---
status: accepted
date: 2026-11-28
decision-makers: Team endue
---

# The knowledge graph is derived from session items and never edited

## Context and Problem Statement

With agent sessions in the index (ADR 0403), the plugin `endue.knowledge` turns them into a knowledge
base: a graph of sessions and the things they touched, details for each, notes, and tools agents can
ask. Linked as they come, a month of sessions knots into one component in which nearly every session
neighbours dozens of others: they all share their repository and `main`. What is the graph, how are
links weighed so it can be read, and where do notes live?

## Decision Drivers

* The sessions are the source of truth; a second copy that drifts from them helps nobody
* A rare shared file says more than a branch every session ran on
* Ticket keys and requirement IDs look alike (`ACME-868`, `RQ-09`, `AC-1`)
* Agents should be able to ask what earlier sessions did with a file or a ticket
* Notes should be plain Markdown a person can keep and open in endue or any Markdown editor

## Considered Options

* A graph computed in the plugin from the items, weighed by relation and rarity, notes regenerated
* A graph stored as its own items (entities and edges), updated incrementally
* A graph whose notes people edit, merged with each regeneration

## Decision Outcome

Chosen option: "computed in the plugin", because the whole graph builds from the session items in
milliseconds and anything stored would only repeat them. Sessions and things form a bipartite graph. A
link weighs by its relation (opened 1.0, edited 0.8, branch 0.7, cites 0.6, read 0.2) and a mention by
where it was found (prompt 0.9, answer or command 0.5); a thing weighs by its rarity, log((N + 1) / df).
A thing linked to more than 5 % of sessions (`endue.knowledge.hub`) is a hub: a filter, not a node.
Things are drawn when at least two sessions share them (`endue.knowledge.shared`). A key prefix seen in a
branch name is a project's ticket; other keys are requirement IDs; `endue.knowledge.ignore` drops some
(`AC`). The layout runs in a worker (Barnes–Hut), seeded with earlier positions. Notes are generated in
`~/.desk/knowledge`, one per ticket, requirement, pull request, issue, ADR and memory note (300 at most),
linked as `[[name]]`; their front matter says edits are overwritten. `endue.knowledge.search`, `related`
and `note` are read-only agent tools (ADR 0088). The page fits the window the desk first opens (400×263):
there the graph stands alone and the filters and the details lie over it.

### Consequences

* Good, because the graph never drifts from the sessions, and a changed weight applies to all of it.
* Good, because the notes folder opens in any editor that follows `[[wiki links]]`, and agents reach
  the same answers over MCP.
* Bad, because the graph is rebuilt in the page on every change: fine for thousands of sessions, a worker
  or the index's own queries will be needed past tens of thousands.
* Bad, because notes are not a place to write: a person's own notes belong next to them, not in them.
