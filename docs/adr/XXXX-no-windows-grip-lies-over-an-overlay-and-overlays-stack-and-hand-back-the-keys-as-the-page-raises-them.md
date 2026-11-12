---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0190 (the permission prompter is a hidden overlay): its consequence "the keys go to the
desk's page, not back to the window that had them, when the overlay hides" no longer holds where
another overlay is up. Amends ADR 0160 (the system layer's overlays) and ADR 0153 (the window
manager on the compositor's input).

# No window's grip lies over an overlay, and overlays stack and hand back the keys as the page raises them

## Context and Problem Statement

A permission question is the `endue.permissions` overlay, drawn over the whole app above every
window (ADR 0190). At 1280 × 800 on the first layout, the card's buttons lie over the edges of the
windows under it: in the QA's layout the middles of Allow once, Allow this session, Always allow
and Don't allow were each on a window's resize grip. The window manager hears every press first and, on a grip of the
window topmost under the pointer, sends the press to the desk's page alone, which finds the grip
(ADR 0153); it did not know the overlay lies over that window. So a press on the button reached the
page's place for the overlay (`desk-surface-frame`) and never the question; the router then gave the
keys to the window in use, as a press on the page does (ADR 0192), and Escape went there too. The
asking call waited for ever. QA saw it as "the third card takes neither a click nor the keys"; it
was every card, wherever a button lay over a grip, and the cursor there was the grip's. Besides, the
compositor drew the overlays in the order the page named them, not as the page stacks them, so the
palette opened over a question was drawn under it while it had the keys; and a question answered
over the palette gave the keys to the window in use, the palette still up. How does every card,
whatever lies under it and whatever overlay is up, take the pointer and the keys?

## Decision Drivers

* A press on what is drawn in front reaches it: a card's button is the card's, wherever a window's
  grip, title bar or edge lies under it
* What the compositor draws in front, what takes the pointer there and what has the keys agree
* An overlay answered or closed over another leaves the keys with the one still up
* No change to the page's DOM, the window manager's crate or a plugin

## Considered Options

* The system layer lies over every window for the window manager too: the shell gives `desk-wm`
  the boxes of the page's parts and of every system surface it shows (edge bars, overlays) as what
  lies above the windows, and finds no grip under them; overlays are drawn by the page's stacking
  order; the runtime hands the focus of an overlay that hides to the overlay in front
* Route a press on an overlay past the window manager, as a popup's (ADR 0196): that leaves the
  cursor and a press on a gliding window under an overlay to the window manager still
* Keep a permission question always above every other overlay: the palette opened over it would
  have the keys under it

## Decision Outcome

Chosen option: "the system layer lies over every window for the window manager too", because the
window manager already keeps the page's parts and the edge bars apart (its cursor, a press on a
window gliding); an overlay is one more of them.

* `compositor_window/system.rs`: `over_windows` is the boxes of the page's named parts and of every
  plugin surface it shows itself, edge bars and overlays; `on_grip` finds a grip only where none of
  them lies. `hosted.rs` and `wm.rs` give `desk-wm` the same boxes as its system parts, so neither
  its cursor nor a press on a gliding window counts under an overlay or the dock.
* The page reports each system surface's stacking order (`Place.z`, the section's `z-index`, which
  the runtime raises for each overlay shown, `apps/desk/src/compositor-desk.ts`), and the compositor
  draws each layer's surfaces in it, the page's order breaking ties; the hit test follows.
* `packages/runtime/src/surfaces.ts`: an overlay with the page's focus that hides gives it to the
  overlay still shown in front, so its surface has the keys (ADR 0192's router follows the page's
  focus); with none up, the keys follow the window in use as before.

### Consequences

* Good, because every card takes a press on any of its buttons and the keys, over any window, after
  the palette, over the palette, two at once and right after the last one hid
  (`e2e/specs/permission-prompt.spec.ts`).
* Good, because the dock hears a press on itself over a window's edge, and no grip's or title bar's
  cursor shows over an overlay or a bar.
* Good, because the palette closed over a question, or a question answered over the palette, or
  the first run, leaves the keys with what is still up.
* Bad, because while an overlay shows no window can be resized or moved from under it, also where
  its page paints nothing; every overlay today covers the app with its scrim, so nothing changes for
  the person.
* Neutral, because the page's report carries one more field per system surface.

## More Information

Found by the QA of C21 (Archives, #162) on main; work order B9b, a follow-up of B9 (ADR 0190).
Code: `apps/desk/shell/src/compositor_window/{system,wm,hosted,report}.rs`,
`apps/desk/src/compositor-desk.ts`, `packages/runtime/src/surfaces.ts`. Tests:
`compositor_window/system_tests.rs` (no grip under an overlay or the dock),
`compositor_window/system_stack_tests.rs`, `apps/desk/src/compositor-desk.test.ts`,
`packages/runtime/src/surfaces.test.ts`, app e2e `e2e/specs/permission-prompt.spec.ts`.
`docs/architecture.md` does not describe the window manager's grips or the overlays' order, so it
does not change.
