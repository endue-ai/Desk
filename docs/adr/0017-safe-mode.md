---
status: accepted
date: 2026-10-28
decision-makers: Team endue
---

# Safe mode runs built-in plugins only, and starts on its own after failed launches

## Context and Problem Statement

Everything above the core is a plugin the person can change while Desk runs, including the plugin list
itself (`endue.sidebar`). A community plugin that hangs the desk, a saved layout that hides everything,
or a plugin list that was switched off leaves no way back from inside Desk. Emacs has `emacs -q`: start
without the person's configuration. What is Desk's equivalent, how is it started, and what can be fixed
from it?

## Decision Drivers

* There must always be a way back without editing files by hand
* Safe mode must not erase the person's setup: it skips it, and fixing things in it must stick
* A desk that cannot start must not need a command line to recover (macOS apps rarely get flags)
* The core enforces it, not only the runtime

## Considered Options

* Built-ins only, with the person's flags kept and editable; started by flag, environment, a restart
  request or two failed launches in a row
* Start with nothing mounted but a recovery screen
* Reset all settings to defaults

## Decision Outcome

Chosen option: "Built-ins only, flags kept and editable".

* Starting it: `--safe-mode`, `DESK_SAFE_MODE=1`, "Restart in safe mode" (sets `safeNext` for the next
  launch), or on its own when the last two launches never reached ready. `LaunchGuard` keeps the count
  in `launch.json` in the app's data folder; `desk_ready` resets it.
* Core (`Core::with_safe_mode`): built-in plugins get their manifest permissions as usual; other plugins
  stay installed and listed, but `perm.request` refuses them without a prompt, so they hold no grants.
* Runtime (`safeMode` option, read from the `desk_boot` command): every built-in UI plugin is mounted
  whatever its enabled flag, no other plugin is mounted, and the layout starts from the default without
  loading or saving the saved one. The status line says why the desk is in safe mode.
* Changes made with the plugin list in safe mode are remembered and apply on the next normal start.

### Consequences

* Good, because the plugin list is always reachable in safe mode, and a broken community plugin or a
  switched-off built-in can be fixed from inside Desk.
* Good, because a desk that dies during startup recovers on the third launch without the person doing
  anything special.
* Bad, because a broken built-in plugin still runs in safe mode; that is an app bug and needs an update.
* Bad, because killing Desk twice during startup (for example while developing) also lands in safe
  mode once; one normal launch clears it.

## More Information

`crates/desk-core/src/launch.rs`, `crates/desk-core/tests/safe_mode.rs`,
`packages/runtime/e2e/safe-mode.spec.ts`, `apps/desk/src-tauri/src/commands/boot.rs`.
