---
status: accepted
date: 2026-11-14
decision-makers: Team endue
---

# A file opener opens each file in a window of its own

## Context and Problem Statement

A person lays several images, or several code and text files, side by side. The desk gave each plugin
one window: the runtime keyed a plugin's frame, surface, window and buffers by its id, so opening a
second file in Images, Notes or Data, or one of them changing on disk, replaced and redrew what that one
window showed (issue 259). ADR 0129 set aside a plugin's Studio for each agent because "one plugin frame
cannot be several windows"; ADR 0160 reaches a plugin's page by its surface's host; ADR 0186 makes one
file one buffer. How does one plugin show in several windows, each its own file, without widening what
the plugin may do?

## Decision Drivers

* Each window shows its own file and updates on its own; opening an open file brings its window forward
* A plugin calls as itself, whatever window it calls from: grants stay per plugin (ADR 0012, ADR 0131)
* A window is a page of its own: its own process, sleep and wake (ADR 0070, ADR 0134), pop out (#235)
* A plugin with one window keeps working unchanged, and so do the runtime's, desk-wm's and the shell's
  keys for it

## Considered Options

* Instances for openers that opt in: the desk opens a window per file, each a page of the plugin
* One window per plugin, with tabs or a split inside the plugin's page
* Plugins open further surfaces themselves (`ui.surface.open`) and route files among them

## Decision Outcome

Chosen option: "instances for openers that opt in", because it is the only one whose windows the
window manager can place, pop out and put to sleep one by one, and it leaves each plugin's code
almost as it is: each page still holds one buffer.

* **Manifest.** A surface may say `instances: "per-file"` (`specs/plugin/v0`): a file opener's first
  surface then opens a window of its own for each file. `--` in a surface id is reserved.
* **Keys and hosts.** A window's key is the plugin id for its first window and `<plugin>@<n>` after;
  the n-th loads on `<surface>--<n>.<plugin label>`. A number is not used twice in a session, so a
  host's page is always its window's. `desk:init` names the window in `instance`; the SDK has
  `ctx.instance`. The shell's relay, web host and `Sender::of` are keyed by host already, so every
  window calls as its plugin.
* **Runtime.** `PluginHost` keys requests, posts, state, greetings, sleepers and owned events by
  window; `bridge.forward` names the plugin. A command run's answer goes to the window that ran it; a
  command the plugin provides runs in its window in use (the one that last had the keys or called).
* **Files and buffers.** `desk.files` chooses the window: one of the opener's windows that holds no
  file, else a new one; a file the opener opens itself (Images walking its folder) stays in the window
  it came from; one already open shows its window. A buffer names its window (`instance`); show,
  revert, save and `desk.files.changed` ask that window; closing a window takes its buffers, and
  closing a file closes its window while another window of the plugin stays. One file is still one
  buffer (ADR 0186).
* **Window manager and compositor.** The adopted id, the window id and the `plugin:<key>` view are the
  window's key. desk-wm's `plugin` already means the adopted surface's id everywhere (slots, the
  drawer, panes, `Plan::seat`, `Surfaces::of`), so it seats every window by its key with no new field;
  the shell reads the plugin from a key (`plugin_of`) where only the plugin counts.
* **Setting.** `desk.files.window`: `per-file` (the default) or `shared`, the old one window.
* `endue.images`, `endue.notes` and `endue.data` opt in first.

### Consequences

* Good, because three images are three windows, each drawn, slept, woken and popped out on its own.
* Good, because grants, settings, commands and the store stay per plugin: a window gains nothing.
* Bad, because each window is a renderer: the live budget (`desk.surfaces.live`, 8) puts the rest to
  sleep, and waking one costs a page load.
* Bad, because which window a plugin's command or `desk.buffers.open` lands in is guessed from the
  window that last had the keys or called, since the core sees only the plugin.
* Bad, because a saved layout's later windows are keyed by number: after a restart the files open
  again in new windows, which may not take the places the old ones had.

## More Information

Issue 259; amends ADR 0129 (a plugin's frame is no longer its one window), ADR 0160 (a plugin's
surface may have several hosts) and ADR 0186. `packages/runtime/src/instances.ts`,
`plugins-events.ts`, `policies/files-windows.ts`.
