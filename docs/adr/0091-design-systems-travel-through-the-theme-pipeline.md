---
status: accepted
date: 2026-11-05
decision-makers: Team endue
---

# Design systems travel through the theme pipeline

## Context and Problem Statement

ADR 0090 makes design systems plugins of kind `design-system` that people save, export, import and get
from others. Themes already have all of that: a user folder the core watches (ADR 0058), `theme.save`,
`theme.import`, `theme.export` and `theme.remove` under `theme:manage`, a one-file bundle, markets with
sha256-checked downloads (ADR 0060), CLI commands and the checks behind them. Do design systems get a
second pipeline, or share this one?

## Decision Drivers

* One way to land a look package on disk: checked as a plugin folder before it is put in place
* Few new bridge methods, permissions and settings: each is a public contract
* People and agents already hold `theme:manage` for the desk's look
* The kinds must stay apart where it matters: a theme is never chosen as a design system

## Considered Options

* Share the pipeline: `theme.*` and markets take kind `design-system` too, in the same user folder
* A parallel pipeline: `design.*` methods, a `design:manage` permission and a `<data>/designs` folder

## Decision Outcome

Chosen option: "share the pipeline", because the work is the same (validate a data-only plugin folder,
put it in place, watch it, bundle it, download it) and a second copy would drift.

* `theme.save` and `theme.import` accept a manifest of kind `theme` or `design-system`; `theme.export`
  and `theme.remove` take either; `<data>/themes` holds both, and a design system is always on, as a theme
  is. `theme:manage` covers both: it manages the desk's look.
* A design system travels as a `.desk-design` file: the same bundle format (`desk-theme/1`) whose
  manifest is of kind `design-system`. It has no files.
* A market index entry has an optional `kind` (`theme` by default); a bundle's kind must match it. The
  core reads the indexes `desk.theme.markets` and then `desk.design.markets` list (`desk.design`'s
  default is this repository's `market/design-systems/index.json`), and `theme.market.list` merges them.
* The runtime keeps kinds apart: `desk.theme.active` names only themes, `desk.design.active` only design
  systems, and each studio lists only its own kind.

### Consequences

* Good, because saving, importing, exporting, removing, watching, downloading and the CLI work for
  design systems with a few lines of change, under tests that already exist
* Good, because one permission and one market listing cover the desk's whole look
* Bad, because the names say "theme" for a pipeline that carries design systems too
* Bad, because a market index mixes kinds, so each studio filters what it lists

## More Information

`specs/bridge/v0/theme.schema.json`, `specs/plugin/v0/theme.schema.json` (ThemeBundle),
`specs/plugin/v0/theme-index.schema.json`, ADR 0058, ADR 0060, ADR 0090.
