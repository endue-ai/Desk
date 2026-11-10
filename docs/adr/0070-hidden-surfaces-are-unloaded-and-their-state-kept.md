---
status: proposed
date: 2026-11-02
decision-makers: Team endue
---

# Hidden surfaces are unloaded and their state kept

## Context and Problem Statement

Every UI plugin surface is a sandboxed iframe with a page of its own, and the shell keeps every
plugin window's frame live: one wholly behind another window or off the screen costs as much memory
and work as one in front. A session with thirty windows keeps thirty pages alive while a person sees
a few. When may the runtime take a frame away, how does the plugin come back as it was, and how many
frames may be live at once?

## Decision Drivers

* Memory follows what the person sees, not what was ever opened
* A plugin comes back as it was (what is open, the caret, the scroll) or, if it says nothing, cold
* Plugins opt in: an old plugin keeps working, it just comes back cold
* Focus, layout, buffers and the plugin's on/off state (autoload included, ADR 0046) do not change
* The bridge stays the contract (ADR 0012): the request has a schema and vectors like the rest

## Considered Options

* The runtime unloads a frame out of sight after a while and asks the plugin for its state first
  (`ui.surface.state`), with a cap on live frames
* Keep every frame, and let plugins drop their own heavy content when told they are hidden
* Unload without asking, relying on `ctx.state` (`desk:state`), which plugins push whenever they like
* Suspend frames with a browser API (WebKit has no frame freezing a page can ask for)

## Decision Outcome

Chosen option: "unload after a while, ask first, cap the live frames", because only removing the
iframe frees its page, and asking at that moment costs a plugin nothing while it runs.

* Which: centre and floating surfaces (the shell's windows; grid cells without a shell). Edge bars
  and overlays (Eris, the explorer, the palette, views) stay live and do not count.
* Out of sight: the surface's section is off the page or hidden, or every shell window showing it on
  the current desktop is wholly covered by windows drawn above it or off the screen
  (`packages/runtime/src/surface/cover.ts`). The surface the keys go to never is; the app being in
  the background does not count.
* When: after `desk.display.unload-after` seconds out of sight (300; 0 never), or at once for the one
  hidden longest while more than `desk.display.live-surfaces` frames are live (24; 0 no cap). Timers
  are `setTimeout`, which a hidden page keeps, not animation frames. ADR 0134 replaced the cap with
  the live budget: past `desk.surfaces.live` windows out of sight, the least recently focused go.
* How: the runtime sends the frame `ui.surface.state { surface }` (specs/bridge/v0, a request to the
  frame, not a `BridgeRequest`) and waits two seconds. A `state` of JSON up to 64 KiB is kept in the
  runtime's memory for the session; no answer, an error or more than that keeps nothing. The iframe
  is taken out, a placeholder stands in its place, and pending requests to the frame are cancelled.
  The SDK answers with `ctx.surface.onUnload(provider)`.
* Back: when the surface shows again, or a request, a command, a command invocation, a permission
  prompt (`perm.prompt`) or an agent's approval (`perm.approval`) reaches the plugin, the same iframe
  goes back in and loads; its `desk:init` carries `restored` (`ctx.surface.restored`) once. Messages
  that need an answer wait for its hello; other events to an unloaded plugin are dropped. A prompt
  dropped while the Permissions window slept was never asked again: the core waited for its answer,
  and the file the plugin asked for never opened. The plugin stays mounted and on throughout. Unless its surface had the
  focus, focus that moves into the frame goes back where it was until the person points at the frame,
  presses Tab or the desk focuses it (a minute at most): plugins that focus their view as they mount,
  some late (Docker waits for its engine), would otherwise pull the keyboard to every window that
  comes back (`frames/settle.ts`; a window in the background gets no focus events in WKWebView, so
  the focus is also looked at every 250 ms).
* Notes is the first to keep its state: open notes, unsaved text, watches, caret and scroll.
* Asleep from the start (#590): with a saved session to put back, an enabled UI plugin that is not
  autoload (ADR 0046), whose surface is a window (centre or floating) and that the session does not
  show (no grid cell, no saved file, not the surface in use) mounts without a surface. Its manifest
  commands are registered, so its keys and palette entries work; the first command, request,
  command invocation, prompt or launch opens its surface, and what needs an answer waits for its
  hello as above. The shell opens the ones a window of the desktop in front places, after its own
  part is restored and whenever that layout changes (`surface/placed.ts`). Edge bars and overlays
  always mount, and with no session to put back every plugin mounts, so a first start is unchanged.
  A part of the session names what it shows in a `shows` list: the shell's part names the plugin
  windows open and not in the drawer (#76), so they mount too and come back on their slots and at
  their pans; one put away in the drawer starts asleep and wakes when it is raised.
  `PluginHost.asleep` tells a sleeping frame from one that stopped answering.

### Consequences

* Good, because memory now follows the windows in sight, with a cap a person can set.
* Good, because a plugin comes back as it was with one provider, and an old one still works cold.
* Bad, because a plugin unloaded with work running in the core (a terminal's process) loses the
  events sent meanwhile; it keeps its ids in its state and reads what it needs again.
* Bad, because state is bounded: Notes' unsaved text beyond 64 KiB comes back from disk instead.
* Bad, because plugin windows are on every desktop today (ADR 0040), so another desktop hides a
  plugin only through its section leaving the page; per-desktop plugin windows are a later change.

## More Information

`packages/runtime/src/frames/`, `packages/plugin-sdk/src/surface-state.ts`,
`specs/bridge/v0/ui.schema.json` and its `ui-surface-state-*` vectors, `plugins/display/plugin.json`,
`plugins/notes/ui/keep.js`; starting asleep: `frames/start-asleep.ts`, `policies/session.ts`
(`shows`), `shell/link.ts` (the shell's `shows`). Tests: `frames/unload.test.ts`,
`frames/policy.test.ts`, `frames/start-asleep.test.ts`, `frames/start-asleep-desk.test.ts`,
`policies/session-shows.test.ts`, `shell/link.test.ts`, `surface/placed.test.ts`,
`surface/cover.test.ts`, `plugin-sdk/src/surface-state.test.ts`, `plugins/notes/tests/unload.test.ts`,
`packages/runtime/e2e/unload.spec.ts`. A watchdog for frames that stop answering (#272) will share this
lifecycle.
