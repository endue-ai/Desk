---
status: accepted
date: 2026-10-27
decision-makers: Team endue
---

# Runtime snapshots are serialised render trees, not screenshots

## Context and Problem Statement

The runtime needs deterministic render snapshots in Playwright. Pixel screenshots differ between
macOS, Linux and Windows (font rasterisation, anti-aliasing), so a baseline recorded on one machine
fails on another, and running everything in one container makes local runs heavy. What do we snapshot?

## Decision Drivers

* The same snapshot passes on every OS and in CI, with no container
* Diffs a reviewer can read in a pull request
* Catches the regressions that matter: structure, placement, theme colours, animation state

## Considered Options

* Serialised render trees: structure, rounded layout boxes, selected computed styles and text
* Pixel screenshots with per-OS baselines
* Pixel screenshots recorded and compared only inside one Playwright container

## Decision Outcome

Chosen option: "serialised render trees" (`packages/runtime/e2e/render-tree.ts`). Every box the tree
records is sized by CSS, not by text, and animations run on an injected clock, so the tree is identical
on every OS. Snapshots are JSON files next to the specs and diff like code.

### Consequences

* Good, because `just test-e2e` gives the same answer on a laptop and in CI.
* Good, because a failing snapshot shows exactly which element, box or colour changed.
* Bad, because glyph rendering and visual polish are not covered. Pixel screenshots arrive with the
  per-engine visual regression stage, recorded in a fixed container.

## More Information

Snapshots live in `packages/runtime/e2e/__snapshots__` (excluded from biome). Issue #8.
