---
status: accepted
date: 2026-11-10
decision-makers: Team endue
---

# Only visible windows and the most recent eight keep a live process

## Context and Problem Statement

Under ADR 0140 every live web surface is a Chromium renderer process. On today's app the runtime
already keeps only the windows in sight and the N most recently focused ones live, N being
`desk.surfaces.live` with a default of 8 that was an estimate (ADR 0134, #37). Processes have a real
price, and the PoC measured it on macOS (Apple M4 Max, CEF 156, physical footprint per process):

| Surfaces | Page | Total | Our compositor | CEF GPU process | Renderer each (median) | First paint median / max |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | — | 524 MiB | 458 MiB | 26 MiB | — | — |
| 1 | light | 916 MiB | 481 MiB | 329 MiB | 39 MiB | 137 ms |
| 10 | light | 2,002 MiB | 627 MiB | 897 MiB | 41 MiB | 182 / 217 ms |
| 30 | light | 3,995 MiB | 929 MiB | 1,708 MiB | 43 MiB | 382 / 464 ms |
| 10 | heavy | 6,626 MiB | 991 MiB | 384 MiB | 511 MiB | 1,005 / 1,032 ms |

`light` animates every frame; `heavy` is a static 10,000-row table. Every process that renders with
Metal pays a fixed ~390 MiB to Apple's GPU driver, whatever the frame size: our compositor and CEF's
GPU process each pay it once. An animating light surface costs ~100 MiB at the margin: ~40 MiB of
renderer, ~50 MiB of GPU-process frame buffers and ~15 MiB of imported texture in the compositor.
Content dominates heavy pages. How many surfaces may keep a process, what does a live hidden one
cost, and how is the bound held on Chromium?

## Decision Drivers

* Memory follows what the person sees and uses, however many windows are open
* A window the person goes back to shows at once; one left long ago may load again in under half a
  second
* One number bounds the runtime's live frames today and Chromium's renderer processes tomorrow
* Chromium's own low-memory heuristics never decide which windows share a process

## Considered Options

* The live set: every visible surface plus the 8 most recently focused, with a memory cap behind it
* A memory cap only: sleep the least recent surface when the surfaces' memory passes a limit
* No bound of our own: let Chromium consolidate renderers under memory pressure, its default

## Decision Outcome

Chosen option: "the live set, with a memory cap behind it", because it bounds the processes by what
the person sees plus a number they set, and the PoC shows that 8 is affordable: 8 animating surfaces
add about 0.8 GiB over a base of about 0.9 GiB on macOS.

* Live surfaces are every visible surface plus the N most recently focused hidden ones. N is
  `desk.surfaces.live` (ADR 0134); its default stays 8, now measured rather than estimated. Edge
  bars, overlays and the system layer do not count.
* Every other surface sleeps: its renderer exits, the window shows the last frame greyed (the
  placeholder of ADR 0070 until the compositor has the texture), and `desk:state` and
  `ui.surface.state` hand the plugin its state back on wake. A sleeping surface costs its last frame.
* Hidden surfaces that stay live stop painting (`WasHidden`), idle ones paint at a lower
  `windowless_frame_rate`, and background renderers get Chromium's background priority: the GPU
  process grows by ~50 MiB per surface that keeps animating.
* Chromium's renderer limit (`--renderer-process-limit`) is set explicitly from the same budget
  (#44), so Chromium never consolidates surfaces under its own heuristics.
* A hard cap on the surfaces' total memory sleeps the least recent ones early, whatever N says, so a
  few heavy pages (~500 MiB each) cannot exhaust memory inside the budget.
* Hundreds of windows are placements, not processes: 300 windows are about 10 to 15 renderers.

### Consequences

* Good, because memory is bounded by what is in sight plus 8, however many windows a session holds.
* Good, because waking a surface costs about one first paint: 137–248 ms alone, under 470 ms with 30
  starting at once.
* Bad, because the base is high before any plugin runs: about 0.9 GiB on macOS, most of it Apple's
  GPU driver (~390 MiB per rendering process), not CEF or our code. Native plugins that render
  (Stage 3) pay that fixed cost too, which argues for no more rendering processes than the two we
  have.
* Bad, because a heavy surface counts as one like a light one; only the memory cap catches it, and
  its value waits for Windows and Linux numbers (#61).
* Bad, because a plugin that keeps no state comes back cold more often.
* Bad, because every number is from one Mac with the screen locked: on-screen presentation, Windows
  and Linux are not measured yet (#61).

## More Information

Epic #32 §8; PoC #35 and `spikes/compositor/README.md` (the full table and findings 3 and 5). Builds
on ADR 0134 (the runtime's live set, #37) and ADR 0070 (sleeping and kept state); #44 sets the
renderer limit, #52 stops hidden surfaces painting. ADR 0140 is the direction.
