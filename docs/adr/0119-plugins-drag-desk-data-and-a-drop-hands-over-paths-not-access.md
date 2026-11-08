---
status: accepted
date: 2026-11-07
decision-makers: Team endue
---

# Plugins drag desk data, and a drop hands over paths, not access

## Context and Problem Statement

Plugins run in sandboxed frames (ADR 0012, 0048) and talk to the desk by `postMessage` alone. The
person wants to drag between them: a file from the Explorer into a folder or into a note, rows out of a
database, a container onto a terminal. Today a drag cannot cross frames. The frame protocol has no
drag messages. The Explorer's HTML5 row drag reached only its own frame, and #535 removed it because a
click that moved a few pixels in WebKit became a drag and the file did not open. With Tauri's file drop
on, Windows' webview delivers no HTML5 drags at all. How does a drag cross frames? What does it carry?
Who decides what a drop does? What may a frame do with what it receives?

## Decision Drivers

* The same behaviour in WKWebView, WebView2 and WebKitGTK, and in the runtime's e2e browser
* A press that does not move stays a click: the WebKit problem behind #535 must not come back
* A frame learns nothing of a drag it cannot take, and receives its items only when it drops them
* A drop is never a grant: the permission model (ADR 0029) stays the only way to reach a file
* Drags from the OS land in a plugin through the same contract
* Additive to bridge v0 (ADR 0004): no bridge or manifest schema change

## Considered Options

* HTML5 drag and drop across frames, with the desk reading `dataTransfer`
* The runtime brokers a pointer drag: frames send moves, the desk hit-tests and relays
* A bridge method family (`dnd.*`) in the core

## Decision Outcome

Chosen option: "the runtime brokers a pointer drag", because the runtime already knows every frame and
where it sits on the page. It needs no browser support for drags between cross-origin sandboxed
frames, which WebView2 lacks with Tauri's drop on and which WebKit draws inconsistently.

* **Desk data.** A drag offers each of these types at most once:
  * `desk/paths`: absolute bridge paths, each with `kind: "file" | "folder"` when the source knows
  * `desk/text` and `desk/uri`
  * `desk/json`, with a `kind` such as `db/rows`, offered as the type `desk/json:<kind>`
  * `text/plain`, which the runtime adds from the other items when the source gives none

  The runtime reads a drag at the trust boundary (`packages/runtime/src/dnd/data.ts`) and refuses it
  whole when any item fails:
  * a path is relative, holds a `..` segment or a NUL byte
  * a URI is not one, or is `javascript:`
  * a JSON `kind` is not lowercase segments
  * the items are more than 4 MiB
  * the image is not `data:image/(png|jpeg|gif|webp)` of 512 KiB at most
* **The protocol** is internal to the runtime and the SDK, documented in `docs/plugins/authoring.md`:
  * The source frame sends `desk:drag-start` with the items, `effectAllowed` and an optional image.
    While the button is down it sends `desk:drag-move` with the modifier keys, then `desk:drag-end`
    or `desk:drag-cancel` (Escape).
  * Every frame says which types its targets accept (`desk:drop-types`).
  * The frame under the pointer gets `desk:dragenter`, `desk:dragover` and `desk:dragleave` with
    the offered types it accepts, in its own coordinates. It answers each with `desk:drag-status`:
    `copy`, `move`, `link` or `none`.
  * On release the runtime waits up to 400 ms for the answer to the last hover. It sends `desk:drop`
    with the items that frame accepts only when the answer was an effect, and `desk:drop-done`
    returns the effect performed.
  * The source hears `desk:drag-feedback` (for its cursor) and `desk:drag-ended { effect, to }`.
  * A frame that accepts none of the offered types hears nothing at all.
* **Drawing.** The desk draws the drag image above every frame, with the answered effect (`+` copy,
  `↗` link, `⊘` refused), and a transparent shield over the frames. If the pointer leaves the source's
  hands, the shield takes it, and no frame under it reacts on its own. The SDK marks the landing element
  with `data-desk-drop="<effect>"` for the plugin's CSS. The source shows the effect as its cursor.
* **Effects.** The target decides. By default Alt copies, Mod moves and both link, as Finder does;
  otherwise the target's preference order wins.
* **The SDK.**
  * `ctx.dnd.startDrag({ items, effectAllowed, image })`
  * `onDrop(target, handler, { accept, at, effect, effects })` and `acceptTypes(target, types)`
  * `draggable(list, { item })`: a press becomes a drag only past `DRAG_THRESHOLD` (6 px), and the
    browser's own `dragstart` never starts on such a row
  * `host.dnd` on `@endue-ai/plugin-sdk/testing` plays the broker
* **The OS.** `apps/desk/src/native-files.ts` turns Tauri's drag events into a `desk:native-drag`
  event on the desk's page, in CSS pixels. The broker offers the paths as `desk/paths` with
  `effectAllowed: ["copy", "link"]`: a drop from Finder never moves the person's files out of their
  folder. The drop's `taken` promise tells the app whether a plugin performed an effect; if none did,
  the app opens the files as before. Plugin frames cannot dispatch this event: they are cross-origin to
  the page.
* **A person's gesture, not a frame's word.** The broker starts a frame's drag only while the desk's
  page has transient user activation (`navigator.userActivation.isActive`), which a press inside any
  frame gives its ancestors. A frame cannot post a drag start and end by itself to drop paths on the
  Explorer, which would then move or copy them under its own grants. A webview without the API
  allows the drag.
* **A drop hands over paths and data, not access.** Receiving `desk/paths` grants nothing. A plugin
  that wants to read or change a dropped path calls `fs.*` (or `desk.files`) under its own grants,
  and asks with `perm.request` when they do not cover it. The Explorer moves dropped paths with
  `fs.rename` and copies them with `fs.copy` (#553, ADR 0125). Each call carries the Explorer's own scopes on
  both ends. A refusal asks once for the scope the core named. The desk's undo reverses the move
  (ADR 0076, 0077).

### Consequences

* Good, because one mechanism works in every webview and in the e2e browser. Built-in and community
  plugins use the same API, and the threshold keeps clicks clicks.
* Good, because a frame sees a drag's types only if it can take them, and its items only when they
  land on it, and nothing a drop delivers widens what a plugin may read.
* Good, because OS drops reach the plugin under the pointer and still open elsewhere, as before.
* Bad, because only one drag runs at a time, and a pointer drag cannot leave the desk's window: you
  cannot drag a file from a plugin into Finder.
* Bad, because the source depends on keeping the pointer while the button is down: WebKit's subframe
  capture, or pointer capture. The shield catches what escapes, but the source frame's moves are
  posted messages, about one frame behind the pointer.
* Bad, because a press held longer than the webview's transient activation (a few seconds) before the
  pointer moves no longer starts a drag; pressing again does.
* Bad, because the bottom edge's drop zone (`shell/Bottom.ts`) still reads HTML5 `Files` drops, until
  it joins the broker as a desk target.

## More Information

Issue #544. `packages/runtime/src/dnd/` (broker, data, geometry, layer, OS drags),
`packages/plugin-sdk/src/dnd/`, `packages/plugin-sdk/src/drag.ts`, `plugins/explorer/ui/drops.js`,
`plugins/notes/ui/drops.js`, `packages/runtime/e2e/dnd.spec.ts`. ADR 0012 (frames), ADR 0029 (grants),
ADR 0076 and 0077 (history and undo), ADR 0125 (`fs.rename`, `fs.copy`, `fs.trash`).
