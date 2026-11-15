---
status: accepted
date: 2026-11-16
decision-makers: Team endue
---

Amends ADR 0150 (the compositor's overlays are the drag image alone), ADR 0151 (no ring goes round
the focused plugin's pane), ADR 0209 (no ring follows a pane's corners) and ADR 0227 (a window's
frame and its content change size together, with no ring between them).

# The compositor draws no focus ring round a pane

## Context and Problem Statement

Since #56 the CEF shell's compositor drew a 2 px ring in the desk's accent (`#4c8dff`) round the
plugin pane that had the keys, in its window's group (ADR 0219), rounded with the frame's corners
(ADR 0209) and sized to the frame as drawn while a resize ran ahead of the picture (ADR 0227). Eris's
history drew a ring of its own, the design system's focus outline round `#conversation`, when it
took the focus so the keys could scroll it.

The maintainer found both bad UX (#320): the window in use already says it has the keys, its
frame and title bar are drawn as the window in use (`w.focused`), and a ring round the whole of a
window's body, or round a whole transcript, frames content rather than marking a control. What
marks the focus inside a desk window?

## Decision Drivers

* The person can tell which window has the keys
* A keyboard user can tell which control in it has the focus (WCAG 2.4.7)
* No colour laid over a window's content
* One way to mark the window in use, not two

## Considered Options

* Keep the ring, quieter (thinner, the border's colour)
* Ring only after a key moved the focus (as `:focus-visible` does in a page)
* No ring: the window in use's frame marks the window, the page's own focus ring marks the control

## Decision Outcome

Chosen option: "No ring", because the frame of the window in use already says which window has the
keys, and a control's own focus ring, which every page draws from the design system's
`--desk-ring` (`.shell :focus-visible`, the kit's controls, `@endue-ai/ui`), says which control
inside it has them. A quieter ring still lay over the content; a ring after keys only would have
had the compositor guess a page's focus modality, which the page knows and draws already.

`overlay::focus_ring`, `draw_pixels::{Ring, ring_of}`, `Drawn::groups` and the ring's arguments to
`register` go, with their tests. Eris's history keeps the focus so the keys scroll it, with
`outline: none`; its say row keeps the design system's ring.

### Consequences

* Good, because nothing is drawn over a window's content but the drag image.
* Good, because the compositor no longer works out a pane's place in the frame as drawn for a ring
  each frame, nor clips it in four quarters.
* Bad, because a window whose page marks no focus of its own (a canvas, a picture) shows the keys'
  place only by its frame; a page that takes the keys must draw its own focus.
* Bad, because a scrolled history with the focus shows no mark until a key scrolls it.

## More Information

Issue #320; the ring came with #56 (ADR 0150) and its corners with #250 (ADR 0209). The motion gate
(`just perf-motion`, ADR 0208) holds for the change, which only removes drawing.
