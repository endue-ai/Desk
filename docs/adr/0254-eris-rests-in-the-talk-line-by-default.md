---
status: proposed
date: 2026-11-16
decision-makers: Team endue
---

# Eris rests in the talk line by default

## Context and Problem Statement

At rest Eris was on the desk twice: her 128 px orb at the top centre, 40 from the app's top, and
the talk line at the bottom centre, which is where a person talks to her. Design #291 ("Bottom
centre: Eris and the talk line") makes the talk line her one place while nothing is said: a 440 by
40 pill with her small orb, the hint and the key, and the large orb only while she listens, thinks
or speaks. A profile's layout can place her (`eris` in a desktop's layout, a person's drag); that
must keep working, and nothing stored may change.

## Decision Drivers

* One place to talk to her at rest; the top centre left to the windows
* Her states, soul text and drawing unchanged, and seen where the person talks to her
* No stored value, setting or profile field changes or migrates
* A desk at rest still draws nothing (ADR 0164); reduced motion still means no motion

## Considered Options

* By default she rests in the pill and comes out above it while she is at work
* She stays at the top centre and the pill gets a small orb of its own beside her
* The large orb is gone: her states are drawn in the pill's small orb

## Decision Outcome

Chosen option: "she rests in the pill and comes out above it", because it is the design's one place
at rest and keeps everything she shows today when she has something to show.

* **The default** is a layout whose `eris` is `null`, as `modes/model.ts` makes it. A non-null
  `eris` (a profile's, as Deep work's, or one the person dragged) places her: she stays there in
  sight at rest, as before. Dragging her out of the pill places her as before (`move-eris`).
* **Out** (`packages/runtime/src/eris/rest.ts`): a state other than idle, a spoken turn listening,
  thinking or speaking, her soul text, a long line kept in her card, or a drag. She stands centred
  over the pill with 12 between (under it when the pill sits high up, `is-high`), wherever the pill
  is placed; her card places itself from her box as before. She goes back `RETURN_MS` (1200) after
  none of these holds, on the frames' clock; her rest after `REST_MS` starts once she is back.
* **At rest** the large orb stays in the DOM, `is-resting`: faded and sunk 12 toward the pill over
  `--motion-base`, then hidden, `aria-hidden` and out of the tab order, so the compositor gets no
  `desk.eris` part for it. A press on the pill, its key or "Hey Eris" opens the talk line as before.
* **No pill** in her root (a plugin holds the dock's role): she rests at the top centre in sight.
* **The pill** (`bottom.css`, `talk-place.ts`): 440 by 40 at rest and under the pointer, whose
  border alone changes; its small orb 18; open as before. Where the pill at rest leaves the running
  chips less than 120 beside it, they rise above it as they do above the open line.

### Consequences

* Good, because the desk at rest shows her once, where the person talks to her
* Good, because nothing stored changes: a profile that placed her, and every saved drag, keeps her
* Good, because her states, voice and drawing are untouched; only where the large orb stands moves
* Bad, because at rest there is no large orb to click for a spoken turn: the pill opens the typed
  line, and a spoken turn starts with "Hey Eris" or a press on her once she is out
* Bad, because out above the pill she can cover the running chips in a narrow app for as long as
  she speaks
* Bad, because a person who liked her at the top centre has to drag her there once

### Confirmation

`packages/runtime/src/eris/Eris.rest.test.ts`, `shell/TalkChrome.test.ts`,
`shell/talk-place.test.ts`; painted in `packages/runtime/e2e/shell-eris.spec.ts`,
`eris-said.spec.ts`, `shell-talk.spec.ts`, `shell.spec.ts`, `shell-away.spec.ts`,
`shell-a11y.spec.ts` and `shell-sizes.spec.ts`.

## Pros and Cons of the Options

### A small orb beside her at the top centre

* Good, because nothing moves
* Bad, because she is still on the desk twice at rest, which is the problem

### Her states in the pill's small orb

* Good, because one orb, always in the same place
* Bad, because at 18 px her mesh, rings and soul text cannot be read: her drawing would change,
  which is out of scope

## More Information

Issue #297, design #291. `docs/ko/desk-structure.md` does not describe where Eris stands on the
desk (its file tree names `eris/` only), so no section of it changes; the onboarding's Eris
(`plugins/onboarding`), the island (ADR 0204) and the floating Eris (ADR 0121) are unchanged. ADR
0164 (a desk at rest draws nothing), ADR 0221 (the chrome while a window fills the app).
