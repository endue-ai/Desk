---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# Granted reversible agent changes offer Undo

## Context and Problem Statement

[ADR 0078](0078-agents-irreversible-actions-wait-for-approval.md) and
[ADR 0096](0096-erises-turns-carry-her-memory-and-she-asks-before-remembering.md) review an agent's changes. A
session grant still left an approval on an ordinary save or fact. A lasting grant could let an
append or a network request run by itself. A permission answer should say which calls it enables.

## Decision Drivers

- Keep action approval for changes without an effective Undo.
- Honor a covering grant of any duration and record its use in the permission log.
- Scope Undo to the changed file or fact and preserve later edits.

## Considered Options

- Keep the action card for every write and fact.
- Let a covering grant authorize the writes the core can reverse and show their Undo after the call.

## Decision Outcome

A covering grant of any duration can authorize an agent's save when it can retain the prior file
version, create a file without replacing an existing entry, or remember or edit a fact. The cap
still applies, and a once grant is spent on the authorized call. Without a covering grant, the
agent waits for action approval. Append, writes without retained versions over existing files,
network fetches, process spawns and marked commands wait even under a lasting grant.

`perm.approval.done` can carry a completion receipt for an approved or granted change. The desk
shows what changed and offers `perm.undoApproval` with that receipt. The core checks the file's
location and written content before restoring the retained version or moving a new file to the
trash. Empty folders created by that write can then be removed. A fact is removed or restored with
its previous tags only while it still matches the saved fact. The notice carries no fact text.

### Consequences

- Each receipt is stored in memory for the current desk process, with a limit of 128 receipts.
- A later file or fact edit can make its earlier receipt unusable. Undo of another change remains
  independent of the most recent global undo entry.
- The permission overlay explains the three grant durations for reversible writes and memory saves.

## More Information

- [Issue #723](https://github.com/endue-ai/endue/issues/723)
