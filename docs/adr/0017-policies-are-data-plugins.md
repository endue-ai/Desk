---
status: accepted
date: 2026-10-29
decision-makers: Team endue
---

# The desk's default policies are data-only plugins, layered like an Emacs init

## Context and Problem Statement

The runtime has mechanisms (surfaces, a grid, a shortcut router, theme tokens) but no policy: nothing
says where a new surface goes, which key runs what, which plugin opens a file, how long a notification
stays, or what a profile turns on. Emacs keeps the same split: the C core has windows and keymaps, and
`window.el`, `bindings.el`, `files.el`, `desktop.el` and `init.el` decide how they are used. Where do
Desk's defaults live, and how does a person or a plugin change them?

## Decision Drivers

* Built-in features use the same API as community plugins, so built-ins can be replaced (design, rule 2)
* Everything is a command: keys, the palette, Eris and agents call the same ids (rule 3)
* Policies change while Desk runs and need no code review of their own (rule 4)
* One place for a person's own choices: `init.yaml` (ADR 0016)

## Considered Options

* Data-only `policy` plugins, with every plugin able to contribute the same data, layered in a fixed order
* Policies as code in logic (Wasm) plugins that answer hooks
* Policies hard-coded in the runtime, configured only through `init.yaml`

## Decision Outcome

Chosen option: "data-only policy plugins", because data can be validated by the spec at install, layered
without running anything, and replaced by turning one plugin off and another on.

* `plugin.json` gains `contributes` (`specs/plugin/v0/contributes.schema.json`): `commands`, `keys`,
  `display`, `files`, `themes`, `settings` and `profiles`. Any plugin may contribute; a new kind,
  `policy`, has no entry and contributes only.
* Nine built-in plugins carry the defaults: `desk.display`, `desk.keys`, `desk.palette` (a UI plugin, the
  only one with code), `desk.buffers`, `desk.files`, `desk.session`, `desk.notify`, `desk.theme` and
  `desk.profiles`.
* Layers, each over the one before: built-in `desk.*` plugins, the other enabled plugins in `plugin.list`
  order, `init.yaml` settings, the active profile's settings, then changes made while Desk runs. A key
  bound again wins; display and file rules of a later layer are asked first; settings and themes outside
  a plugin's own id are ignored. Replacing a default whole is turning its plugin off.
* The runtime keeps the mechanisms and the commands that drive them (`desk.buffers.next`,
  `desk.files.save`, ...). A built-in command is available while the policy plugin that owns it is on.
  Plugins add commands under their own id and answer them through the SDK; plugins run commands with
  `ctx.commands.run`, and the person's keys and the palette run the same ids.
* The core serves what the runtime cannot do alone: `init.get` (the caller's own settings and the start
  profile) and `ui.notify`, which reaches the runtime as a `ui.notified` event after the permission
  check. Settings changed while Desk runs last until it quits unless a profile saves them; Desk never
  writes `init.yaml`.
* "Modes" become profiles, so the word does not collide with Emacs modes: `plugins/profiles`,
  `desk.profiles`, and `init.yaml`'s `mode` key becomes `profile`.

### Consequences

* Good, because every default is a file a person can read, and a plugin can ship a keymap or a theme with
  no code at all.
* Good, because the spec validates every contribution at install, so a typo fails the plugin, not the desk.
* Bad, because policies cannot compute: a rule is a match and an action. Behaviour beyond that is a UI or
  logic plugin answering a command.
* Bad, because the layer order is fixed; a plugin cannot ask to go before the built-ins.

## More Information

`specs/plugin/v0/contributes.schema.json`, `specs/bridge/v0/init.schema.json`,
`packages/runtime/src/{commands,policy,settings}.ts`, `packages/runtime/src/policies/`, and the
plugins `display`, `keys`, `palette`, `buffers`, `files`, `session`, `notify`, `theme` and `profiles`
in `plugins/`. Design:
`docs/ko/desk-structure.md`, "Emacs 처럼, 하나의 OS 처럼".
