---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Extends ADR 0056 (themes are a core system of the main UI) and ADR 0090 (design systems).

# Every page's scrollbars and controls follow the theme from tokens.css

## Context and Problem Statement

Since the compositor became the only desk (#83, ADR 0149) every page is an off-screen Chromium
browser. Off-screen Chromium on macOS draws classic scrollbars, not the OS's overlay ones, in its own
look: light for a page that sets no `color-scheme` (measured on the dock: a 250/250/250 track, a
193/193/193 thumb), a neutral grey under `color-scheme: dark` (44/44/44, 107/107/107), the theme's
colours in neither. Form controls follow the page's `color-scheme`, which of the plugin pages only
Calendar (`dark light`, the OS's scheme) and Eris set, so checkboxes came in three looks and fields
and selects were light in the dark desk (#156, item 5). Only `scrollbar-color` gives those bars the
theme's colours. Where does the rule live so that it reaches every page, the desk's own and each
plugin's, with no change to any of them?

## Decision Drivers

* One rule for every page, not one per plugin; community plugins get it as they are
* The bars and controls follow the theme in force and its scheme, and a design system's check accent
* A page that wants its own look can still have it

## Considered Options

* The rules in `/_desk/tokens.css`, after the tokens: every page links it
* The rules in `/_desk/base.css`: five pages (Mail, Projects, Status, Views, the universal example)
  do not link it
* A user style sheet the shell injects into every browser

## Decision Outcome

Chosen option: "The rules in `/_desk/tokens.css`", because it is the one sheet every page links
already (the desk's own page imports the same file), and it stays in the web layer that owns the
theme: no shell code, and the runtime e2e serves the same file.

* `packages/ui/src/native-css.ts` holds the rules; `tokensCss()` appends them, so `dist/tokens.css`
  and the committed `src/tokens.css` carry them. `color-scheme` is dark at first and wherever
  `data-scheme="dark"`, light under `data-scheme="light"`; `scrollbar-color` is the `--desk-input`
  thumb, which the contrast gate holds 3:1 against `background` and `card` (4.5:1 in high contrast),
  on a transparent track; `scrollbar-width: thin`; `accent-color` is `--desk-check-accent`.
* Every selector is inside `:where()`: the rules weigh nothing and any page rule wins.
* `scripts/ui-lint.mjs` gains the `scheme` rule: a page that does not link `/_desk/tokens.css`, a
  `color-scheme` outside the `[data-scheme]` that names it, and a `scrollbar-color` that is `auto` or
  has a track other than clear or a surface token are findings (the ratchet holds the shell's one).

### Consequences

* Good, because every page's bars and controls follow the theme, its scheme and the design system
  at once, the dock's and the Terminal's too, with no plugin changed but two lines removed.
* Good, because a thin bar takes 11 px of a box where the classic one took 15.
* Bad, because `scrollbar-color` is inherited and Chromium ignores `::-webkit-scrollbar` under any
  value but `auto`: a page that drew its own bars that way must set `scrollbar-color: auto` on the box.
* Bad, because tokens.css is no longer only tokens; its header and `tokensCss()` say so.

## More Information

Issue #156 (draft 02 item 5) and the QA pass of 2026-11-11. Code: `packages/ui/src/native-css.ts`,
`packages/ui/src/tokens-css.ts`, `scripts/ui-lint.mjs`. Tests: `packages/ui/src/native-css.test.ts`,
`packages/ui/src/tokens-css.test.ts`, `scripts/ui-lint.test.mjs`,
`packages/runtime/e2e/design-system.spec.ts`. No section of `docs/ko/desk-structure.md` changes.
