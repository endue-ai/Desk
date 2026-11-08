---
status: accepted
date: 2026-10-29
decision-makers: Team endue
---

# @endue-ai/ui components are framework-free custom elements that read only theme tokens

## Context and Problem Statement

Plugin pages run in sandboxed frames and pick their own UI technology (ADR 0010, ADR 0012). They still
need buttons, fields, lists, dialogs, menus and toasts that look like Desk and follow its theme, which
the `desk.theme` policy plugin changes at run time by redefining the `--desk-*` custom properties. ADR
0010 kept React as the choice for `packages/ui` components. Shipping React components would make
every plugin that wants a native-looking control load React, and would leave plugins written in plain
JavaScript (all of `plugins/` and `examples/` today) with nothing to import. What should `packages/ui`
ship, and how do its components follow the theme?

## Decision Drivers

* A plugin page imports the components through an import map, with no build step and no framework
* Any theme restyles the components without code changes, and a theme switch needs no re-render
* Keyboard use, roles, labels and contrast are the components' job, not each plugin's
* Small: every plugin frame pays for what it imports

## Considered Options

* Autonomous custom elements with open shadow roots whose CSS reads only `--desk-*` custom properties
* React components styled with the same custom properties
* A CSS sheet of classes for native elements (`<button class="desk-button">`), no script

## Decision Outcome

Chosen option: "autonomous custom elements", because they work in any page and under any framework,
custom properties inherit through the shadow boundary so a theme reaches them for free, and the
behaviour a CSS sheet cannot give (focus trap, roving focus, Escape, live regions) lives in one place.
The six are `desk-button`, `desk-input`, `desk-list`, `desk-dialog`, `desk-menu` and `desk-toast`. The
tag names, attributes and the `desk-select` and `close` events are public API from now on. This
replaces the sentence in ADR 0010 that names React for `packages/ui` components; the rest of ADR 0010
stands.

### Consequences

* Good, because a plugin needs one import (`dist/ui.js`, an ES module like `dist/plugin-sdk.js`) and
  `tokens.css`, and React plugins can still use the elements as they are.
* Good, because the shadow CSS names no colour of its own; unit tests check that, and that text
  reaches 4.5:1 under the default tokens.
* Bad, because the elements' tag names and events are hard to rename once plugins use them.
* Bad, because there is no DOM in the unit tests (no jsdom or happy-dom dependency): they run on a
  small DOM fake in the package, and the demo page is checked by people in a browser.
* Bad, because a page that forgets `tokens.css` gets unstyled colours: the elements carry no fallback
  values, on purpose, so a theme is the only source of colour.

## More Information

`packages/ui`, demo at `packages/ui/demo/index.html`. Requirement PKG-05. Issue #66. Theme tokens:
`desk.theme` (PR #56).
