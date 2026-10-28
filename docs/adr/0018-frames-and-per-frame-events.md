---
status: accepted
date: 2026-10-28
decision-makers: Team endue
---

# Frames are OS windows with their own runtime; events go to the frame that started the work

## Context and Problem Statement

Desk had one window, `main`, and the shell emitted every core event to it. Emacs separates the one
process from its frames, and Desk needs the same: more than one window over one core. With several
windows, a terminal's output, a watch's changes or a brain turn must reach the window whose plugin
started them, not every window. Who opens frames, and how are events delivered?

## Decision Drivers

* One core, many windows: plugins, grants and work live in the core, not in a window
* A frame's runtime must not see work another frame started (it would route it to the wrong plugin)
* No new bridge surface for plugins until there is a reason for plugins to open OS windows
* The routing rule must be testable without a webview

## Considered Options

* Frames as Tauri windows opened by the runtime through shell commands; per-frame routing in the shell
  by the frame that made the call, with the rule in desk-core (`FrameRouter`)
* A `ui.frame.*` bridge namespace that plugins call
* One window with virtual desks inside it

## Decision Outcome

Chosen option: "Frames as Tauri windows, routed by the calling frame".

* A frame is a webview window running the same page and its own runtime: `main` first, then
  `frame-<n>`, all with the main window's settings. The runtime opens one with `Mod+Shift+N`; the
  commands are `frame_open`, `frame_close` (the calling frame) and `frame_list`, allowed to `main` and
  `frame-*` only. Plugins cannot open windows.
* `bridge_call` knows the calling window. When a call starts work (`brain.say`, `fs.watch`,
  `proc.spawn`, `audio.capture.start`), the work belongs to that frame; its events are emitted only to
  that window, in order, with events that arrived before the answer delivered first. Events nobody
  owns (`plugin.changed`, `perm.changed`) go to every frame. A frame listens with its own window as
  the target, so it never receives another frame's events.
* Inside a frame the runtime still routes each event to the plugin that started it (`Owners`).
* Each frame keeps its own layout (`main` keeps the key it always had).

### Consequences

* Good, because a terminal or a turn in one frame never shows up in another, and the routing rule is
  covered by unit tests in `crates/desk-core/tests/route.rs`.
* Good, because plugins gain no power over OS windows.
* Bad, because work outlives the frame that started it (ADR 0019) but its events are dropped once the
  frame closes; reattaching a new frame to running work needs a listing call (`proc.list`) later.
* Bad, because every frame mounts every UI plugin; choosing plugins per frame belongs to modes.

## More Information

`crates/desk-core/src/route.rs`, `apps/desk/src-tauri/src/frames.rs`, `apps/desk/src/main.ts`.
