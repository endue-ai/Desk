---
status: accepted
date: 2026-11-05
decision-makers: Team endue
---

# Roles name who fills each edge, the palette and the settings window

## Context and Problem Statement

ADR 0026 and ADR 0028 recommend that the shell's rail, agent bar and bottom edge become the plugins
`plugins/toolbar`, `plugins/sidebar` and `plugins/dock`, one part at a time as the plugin API covers
it, and both name the missing piece every move needs first: a role slot (BR-05), so that a plugin can
say it fills an edge and the person can choose which one does. Today the shell draws its three parts
whatever plugins are on, and an edge plugin turned on sits beside them. How does a plugin declare a
role, how is its provider chosen, and what happens to the shell's own part and to the other
providers?

## Decision Drivers

* A community plugin can take an edge's place with the same API a built-in uses (rules 2 and 9)
* The desk renders as before until the person chooses otherwise
* Turning a chosen provider off removes its edge, rather than bringing back something else unasked
* One mechanism for the edges, the palette and the settings window (BR-05)

## Considered Options

* `provides` in the manifest and a `desk.roles` setting (role → plugin id)
* A placement per role (`placement: rail`), the first enabled plugin winning
* Profiles alone, turning providers on and off

## Decision Outcome

Chosen option: "`provides` and `desk.roles`", because the choice is the person's, kept like any
setting (init.yaml, profiles, the session), and a plugin's manifest only says what it can do.

* **Roles.** `role:rail`, `role:agents` and `role:dock` (the shell's three edges), `role:palette` and
  `role:settings-ui`. A manifest lists the ones it fills in `provides`.
* **Defaults.** A role `desk.roles` does not name keeps its default: the shell's own part for the
  edges, `desk.palette` for the palette, the runtime's settings window for the settings UI. Every
  enabled plugin mounts as before, so nothing changes until a role is named.
* **A named role.** The plugin named fills it alone: the shell's part yields (hidden, not torn down,
  so naming the shell again brings it back where it was), other providers of the role do not mount,
  and a named provider that is turned off, missing or not providing the role leaves the role empty.
* **Where.** `packages/runtime/src/roles.ts` resolves; the plugin host asks it before mounting and
  reconciles when the setting changes; `shell/roles.ts` shows or hides the shell's parts.
  `desk.shell` declares the setting. The toolbar, sidebar, dock and palette declare their roles.

### Consequences

* Good, because a plugin takes an edge's place today, through a manifest field and a setting.
* Good, because the defaults make the change invisible until a person or a profile names a role.
* Bad, because the shell's parts are still runtime code: moving the rail's, the agent bar's and the
  bottom edge's content into their plugins needs plugin API that does not exist yet (popovers past a
  frame's box through `ui.surface`, a system-layer placement, raising another plugin's surface) and
  goes one part at a time, as ADR 0026 recommends.
* Bad, because the settings window's role is resolved but the runtime's window does not yet hand its
  command to a named provider; a plugin named for it mounts, and the desk's own window stays.

## More Information

Issue #477. ADR 0023 (the system layer), 0026 (where the shell lives), 0028 (the desk's edges), 0017
(settings layers). BR-05 in `docs/ko/desk-requirements.md`. `specs/plugin/v0/plugin.schema.json`
(`provides`, `Role`).
