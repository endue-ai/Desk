---
status: accepted
date: 2026-11-08
decision-makers: Team endue
---

# A plugin's setting the person sets in the settings window is kept in the preferences record

## Context and Problem Statement

Twenty-five plugins declare settings in `contributes.settings`, but the settings window drew only
hand-written rows for core keys, and only core settings outlived a restart: `Preferences` keeps
`{ version: 1, values }` at `desk`'s store key `preferences` and drops every key `CORE_SETTINGS`
does not declare (ADR 0055). Settings › Plugins now draws a row for each scalar setting of every
enabled plugin (#593). Where does a value set there live, so it is in force at once and after a
restart, without a new store?

## Decision Drivers

* One path for personal settings: the runtime's layers (ADR 0017) and the record core settings use
* Desk never writes init.yaml (ADR 0017, ADR 0031)
* Keys belong to their owner: desk-core's `settings.set` writes only the caller's own keys
* Session values other runtime code sets for plugin keys (`desk.shell.layouts`) stay session state

## Considered Options

* The runtime's session layer through `Preferences.set`, kept in the `preferences` record under the
  full name
* desk-core's `settings.set` and `settings.json`, with a new `owner` and a write permission for the
  runtime
* Writing init.yaml
* Every session value of any declared key in the record

## Decision Outcome

Chosen option: "the session layer, kept in the `preferences` record", because it is the path core
settings already take, needs no spec or permission change, and the record's shape does not change:
`values` holds `endue.calendar.view` beside `desk.theme.scheme`. `Preferences` keeps a plugin key
it was told to (`set`, which the window calls) or found in the record; other session values of
plugin keys are not kept. A row's Reset forgets the value, and the record drops it.

### Consequences

* Good, because the runtime's policies (desk.buffers, desk.notify, desk.files …) use a change at
  once, and it survives a restart like a core setting.
* Good, because an older runtime reading the record ignores the plugin keys it does not declare.
* Bad, because UI plugins that read only `init.get` do not see the value until the runtime's layers
  move onto `settings.*` (ADR 0031) or the plugin host lays them over a plugin's `init.get`.
* Bad, because `init.get` hands the runtime only `desk.*` settings, so an `endue.*` row shows the
  manifest default rather than init.yaml's value until the person sets one.
* Bad, because an older runtime that saves the record drops the plugin keys from it.

## More Information

Issue #593. Code: `packages/runtime/src/core/preferences.ts`,
`packages/runtime/src/settings-ui/declared.ts`; contract: `specs/runtime/v0/settings.md`. ADR 0017
(setting layers), ADR 0031 (settings in the core), ADR 0055 (core settings). No section of
`docs/ko/desk-structure.md` changes.
