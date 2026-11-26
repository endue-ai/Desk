---
status: accepted
date: 2026-11-26
decision-makers: Team endue
---

# Saved view entries and source choices

## Context and Problem Statement

Agents could not open or read the saved views the desk presents. A view with compatible accounts
asked every time. Requested Universal previews and the builder required a separate Allow click
before asking for source permission. Memory had no named read or forget tool.

## Decision Drivers

- A read uses the saved view and its item query without opening a window.
- Reuse the account the person picked when it still serves that view.
- An explicit request to preview or load a source can ask for its exact scope.
- Forgetting memory waits for approval of one specific entry.

## Considered Options

- Open each view and read its live window as a separate operation.
- Read the item sections from the saved definition with its display query and params.

## Decision Outcome

Views lists and opens saved views. Its read tool shares the item query and clock with the window
and reports section states and entries. It holds back a connector's raw envelope and skips
non-item sources. A read with ambiguous accounts reports that the view needs a selection.
Opening the view can ask for an account and remembers actual choices per saved view. Inline and
explicit temporary bindings leave those choices in place.

A requested Universal preview and the builder's Load ask immediately after a refused read.
Consent retries the refused section or builder source. A displaced view discards its pending
result. The ordinary saved view can still offer an explicit access action when a source is denied.

Memory offers find and open plus a reviewed forget by exact ID. The window keeps fact editing and
its bulk-forget confirmation because those actions involve a person's wording or several entries.

## More Information

- Issue #738, Views, Universal and Memory.
- ADR 0087, Universal views and sources.
- ADR 0367, agent command sources in Universal views.
- ADR 0377, agent aliases.
