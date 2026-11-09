---
status: accepted
date: 2026-11-10
decision-makers: Team endue
---

# Only the windows in sight and the N most recently focused keep a live frame

## Context and Problem Statement

Hundreds of windows must be placements, not live engines (#32 §8): on the compositor each live web
surface is a renderer process of 50–200 MB. The runtime already unloads frames and keeps their state
(ADR 0070), but as an afterthought: a window out of sight goes after five minutes, and only past 24
live frames, counting the visible ones, does the one hidden longest go at once. Which frames may stay
live, so the count stays bounded by what the person sees and uses?

## Decision Drivers

* A bound that holds however many windows are open, and does not depend on how many are in sight
* The windows the person returns to come back at once; the ones they left long ago may reload
* One number that later also bounds Chromium's renderer processes (`--renderer-process-limit`, #44)
* A request, a command or a prompt for a sleeping plugin still reaches it and gets its state back

## Considered Options

* The live set: every window in sight plus the N most recently focused out of sight; the rest sleep
* Keep ADR 0070's cap on all live frames, the one hidden longest first
* Least recently shown instead of focused (being drawn counts as use)

## Decision Outcome

Chosen option: "the live set", because it bounds the frames out of sight by a number the person sets,
keeps the ones they just used, and leaves the ones in sight to the screen's size.

* The live set is every centre or floating surface (a window) in sight, the one with the keys, and the
  N most recently focused windows out of sight. N is the core setting `desk.surfaces.live`, integer,
  default 8, minimum 0 (0 keeps only what is in sight); Settings › General draws it and the
  preferences record keeps it (ADR 0127). It replaces `desk.display.live-surfaces`.
* Recency is focus order: a window that opens, takes the keys or is woken for an answer is the most
  recent. Last pointer use is not tracked apart.
* A window out of the set sleeps at once as ADR 0070 says: asked for its state, its frame taken away,
  the placeholder standing in. Shown or focused, it wakes with that state; if that puts more than N
  out of sight, the least recent of them sleeps.
* A frame loading again for something that waits on it (no hello yet) is not put back to sleep for
  ten seconds, so what waits and the state it is handed are not lost.
* Edge bars, overlays and the system layer are not counted. `desk.display.unload-after` still unloads
  a window out of sight for that long, even inside the set.
* The inspector's Surfaces section says how many frames are live, how many windows are live out of
  sight against N, and which are asleep (`desk.inspect.open { section: "surfaces" }`).

### Consequences

* Good, because twenty or three hundred windows keep at most N frames out of sight, and the compositor
  can give the same N to Chromium.
* Good, because the decisions are one pure function (`frames/live-budget.ts`) the frame policy runs.
* Bad, because a default of 8 is an estimate until the PoC measures renderer memory (#35 changes it).
* Bad, because a plugin that keeps no state comes back cold more often than under the old cap.
* Bad, because a value of `desk.display.live-surfaces` someone set is no longer read.

## More Information

Issue #37, epic #32 §8. Amends ADR 0070's cap. Code: `packages/runtime/src/frames/live-budget.ts`,
`frames/policy.ts`, `frames/install.ts`, `core/defaults.ts`, `inspect/sections.ts`. Tests:
`frames/live-budget.test.ts`, `frames/policy.test.ts`, `frames/unload.test.ts`,
`settings-ui/declared.test.ts`, `packages/runtime/e2e/shell-plugins.spec.ts` (20 windows, N = 8). No
section of `docs/ko/desk-structure.md` changes.
