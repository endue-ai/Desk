---
status: accepted
date: 2026-11-15
decision-makers: Team endue
---

Amends ADR 0205 (`DESK_APP_WINDOWS` no longer alone decides which plugins open out) and ADR 0212 (a
surface's `instances` takes a third value).

# An app says how its window opens, in the desk and out of it

## Context and Problem Statement

Since #235 any window of one plugin moves out of the canvas into an OS window and back (ADR 0205).
The plugin had no say in it. On the canvas its window took its slot's size, a sixth of the free area;
out of it, the size its window had on the canvas and at least 720 × 450; the smallest size was the
desk's in both, and only the person starting the desk (`DESK_APP_WINDOWS`) decided which plugins open
out. An app that is not a file opener had one window, since the runtime mounts a plugin's first
surface once and ADR 0212 opens further windows only for files. And nothing said which of the SDK's
calls hold for a window out of the canvas. How does a plugin say how its window opens, the same for
both places, without a second kind of window?

## Decision Drivers

* One manifest and one page for the canvas and the OS window: nothing in a plugin's code tells them
  apart
* The desk keeps its screen (ADR 0205): a person's arranging, a profile and a session win over a plugin
* No second mechanism beside ADR 0212's windows: one key, one host and one page a window
* A plugin that says nothing opens as before

## Considered Options

* Hints on the surface (`window`), read by the window manager and by the shell
* A separate `app` block in the manifest, beside `surfaces`
* The plugin sizes and moves its own window through new bridge calls (`ui.window.*`)

For several windows:

* A third value of `instances`, `many`, and `another: true` on `desk.plugins.open`
* Mounting every surface a manifest declares as a window of its own
* Nothing: only file openers have several windows

## Decision Outcome

Chosen option: "hints on the surface", with "`instances: many`" for several windows, because the
surface is already what a window shows, both hosts can read it before the page loads, and ADR 0212's
keys already carry a window that holds no file.

* **The hints** (`specs/plugin/v0`, `SurfaceWindow`): `window.size` (the plugin's page the first time
  its window opens), `window.minSize` (the smallest the person can make it, at least 240 × 160),
  `window.resizable` (false: no edge to drag) and `window.opens` (`canvas`, the default, or `out`).
  They are sizes of the page, so they mean the same in both places: on the canvas the window is its
  border and title bar larger. Only a plugin's first surface, placed `center` or `floating`, has a
  window.
* **On the canvas** the runtime hands the hints to `desk-wm` with the surface (`adopt`). A window of one
  plugin opens at its slot with the hinted size, moved inside the free area; a resize stops at the
  hinted minimum; a fixed window refuses a resize and shows no grip. They are hints: a placement a
  profile or a session saved, a fill, a snap and tile size the window as before, and a window split
  into panes follows its panes.
* **Out of the canvas** the shell reads the same manifest: the OS window's inside opens where it was
  last, else at the hinted size, else as before; its minimum is the hinted one; a fixed window is not
  resizable and opens at its hinted size whatever was kept.
* **Opens out.** An app whose manifest says `opens: "out"` pops out the first time its window shows
  in a session, through `desk.windows.pop-out`, as the switch's plugins did. `DESK_APP_WINDOWS` unset
  now means "as the manifests say"; `off` keeps every window on the canvas; `on` and a list of ids
  mean what they meant, beside the manifests. A desk without a compositor ignores `opens`.
* **Several windows.** ADR 0212 already gives a plugin several windows, each a page of its own on
  `<surface>--<n>.<label>`, keyed `<plugin>@<n>`, calling as the plugin. What it lacks is a way to
  open one that holds no file. `instances: "many"` says an app has such windows, and
  `desk.plugins.open { plugin, another: true }` opens one through the same `PluginHost.another` that a
  file's window opens through, answering `{ window }`. No new key, host, message or bridge method.
  Mounting every declared surface was rejected: a plugin's other surfaces are drawn by its one page
  today (the permissions prompt), and it would be a second mechanism.
* **The calls that assumed the canvas.** Showing a plugin (`desk.display.show`, `desk.plugins.open`,
  `desk.files.*`, `desk.buffers.show`) opened a second window on the canvas when the plugin's window
  was out: `desk-wm` now finds the window out and puts it in use where it is. `desk.palette.pick`
  works as it is: the palette shows in the desk's window, which comes forward. A drag (`ctx.dnd`) does
  not cross an OS window's edge (#235): it ends with `none`, and the guide says so. A web view (ADR
  0216) shows in the desk only.

### Consequences

* Good, because an app opens with the same page size on the canvas and out of it, from one manifest
* Good, because a plugin that says nothing, and every saved layout, opens as before
* Good, because an app's several windows and a file opener's are the same windows
* Bad, because `resizable: false` and `size` hold only until the person arranges: a fill, a snap or
  tile still sizes the window on the canvas
* Bad, because a plugin's manifest is read once a session for `opens`: a dev plugin that changes it
  needs a restart
* Bad, because a `many` app's further windows are not opened again after a restart (as ADR 0212's
  later windows), and which one a command lands in is the one in use
* Bad, because a permission's question asked from an OS window shows in the desk's window or the
  island, not beside the app

## More Information

Issue 239, after #235. `crates/desk-wm/src/hints.rs`, `packages/runtime/src/wm/hints.ts`,
`apps/desk/shell/src/app_windows/{hints,switch}.rs`, `packages/runtime/src/plugins-open.ts`.
`examples/plugin-hello-window` opens both ways (`just example plugin-hello-window`, and with
`DESK_APP_WINDOWS=off`); `e2e/specs/app-opens-out.spec.ts` and `app-opens-canvas.spec.ts` run it on
the CEF desk. The motion gate's table for this change is in the pull request.
