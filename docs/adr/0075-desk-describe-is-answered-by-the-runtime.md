---
status: proposed
date: 2026-11-02
decision-makers: Team endue
---

# desk.describe is answered by the runtime, and the CLI asks it over cmd.invoke

## Context and Problem Statement

A builder should be able to ask the desk what anything is (RT-06), as Emacs answers `C-h k`, `C-h f`
and `C-h v`: a key, a command, a setting, a plugin or a grant, in words, with the plugin that
contributes it, the layer that set it (manifest default, init.yaml, profile, session), what it does,
who may call it and its inverse. The answer is wanted in two places: in the desk ("Describe…" in the
palette, `Mod+Shift+/` then the thing) and in the CLI (`desk describe key|command|setting|plugin|grant
<x>`, issue #333). The facts are spread out: the command registry and the grants are the core's
(ADR 0017, 0029), the keymap and the profile and session layers of settings are the runtime's
(`packages/runtime`), and the bridge said nothing about where a plugin's files or init.yaml are. Who
builds the answer, and how does the CLI get the same one?

## Decision Drivers

* One answer, worded once: the palette and the CLI print the same text
* No new bridge method when a command will do (ADR 0017: the registry is the API)
* The answer names files people can open: plugin.json, init.yaml
* Grants are sensitive: describing them must not hand them to a plugin that could not list them
* Additive to bridge v0 (ADR 0004); nothing depends on the unmerged core-settings work (#239)

## Considered Options

* The runtime answers with a command, `desk.describe.open`; the CLI runs it with `show: false`
* A core method `desk.describe`, with the runtime pushing its keymap and layers to the core
* The CLI gathers the facts itself (cmd.list, perm.list, plugin.list) and words them in Rust

## Decision Outcome

Chosen option: "the runtime answers with a command", because the keymap, the profile and the session
are only the runtime's, and a command is reachable from keys, the palette, plugins and the CLI alike.

* `desk.describe.open` is the desk's own command (provider `desk`, always on). With `{ kind, name }`
  it answers a description (`summary`, labelled `lines`, `file`, and `text`, the summary and one
  `Label: value` line per fact) and shows it in a dialog with "Open file" and "Copy"; `show: false`
  only answers. Without arguments it offers a picker (`desk.palette.pick`) and waits for one chord at
  the same time, describing whichever comes first. desk.keys binds it to `Mod+Shift+/`.
* `desk describe <kind> <x>` invokes it over the socket (ADR 0030) and prints `text`. The runtime's
  tests read the same golden texts as the CLI's (`packages/runtime/src/describe/golden/`).
* `PluginInfo.folder` (plugin.list) and `InitGetResult.file` (init.get, rooted at `~` in the home
  folder) are added so the answer can name its file; "Open file" reveals it with shell.open (ADR
  0047 never opens files).
* The app grants the runtime `perm:manage`, so it can list grants. It shows them only to a caller
  that may list them itself (the person, or a `perm:manage` holder such as `cli`); anyone else gets
  the answer without grant facts.

### Consequences

* Good, because one module words every answer, and the CLI and the desk cannot drift apart.
* Good, because the answer works with no plugin on: the dialog is the runtime's, and the picker is
  only offered when the palette is on (a chord still works).
* Bad, because `desk describe` needs a running desk with its runtime: the core alone cannot answer.
* Bad, because the runtime now holds `perm:manage`, so the core addresses `perm.prompt` to it too
  (it does not answer them; the permissions plugin and `cli` already hold the same permission).
* Neutral: settings a plugin resolves through the core (ADR 0031: its own set values, init.yaml's
  keys under its id) are not visible to the runtime, so their answer gives the manifest default and
  says so. init.yaml lines are not named until the core keeps them (#289).

## More Information

Issue #333; RT-06 in `docs/ko/desk-requirements.md`. `packages/runtime/src/describe/` (`explain`,
`installDescribe`, the dialog), `crates/desk-cli/src/remote.rs`, `crates/desk-core/src/plugins.rs`
and `core_init.rs`, `specs/bridge/v0` (plugins, init). Inverse commands come with #276: an `undo`
field on a `cmd.list` entry shows as "Undo: <id>".
