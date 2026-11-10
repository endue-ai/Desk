---
status: accepted
date: 2026-11-10
decision-makers: Team endue
---

Status: amended by ADR 0156: compositor mode is the only desk (no `DESK_COMPOSITOR`, no Stage 1
windowed desk), and the target watch of Stage 1 went with the windowed desk. Amended by ADR 0160: the
stand-in frames, the relay's re-greeting and the stand-in's colour scheme are gone; the runtime's page
posts to each surface by its host and hears it through `__deskNative.onSurface`.

# Web surfaces render off screen, and the runtime's frames stand in for them until the window manager moves

## Context and Problem Statement

ADR 0140 makes every web surface an off-screen CEF browser whose shared texture the compositor
(`desk-compositor`, #50) samples, and ADR 0141 makes the surface protocol (`specs/surface/v0`, #49)
the only thing between the compositor and whatever draws a surface. #52 builds that path. The window
manager, the plugin host and every system surface still live in the shell page's runtime
(`packages/runtime`) until #53 and #55 move them, and plugins must run unchanged: the SDK talks to
`window.parent` with `postMessage`, and the runtime tells plugins apart by the frame a message comes
from. How does each plugin surface become a browser of its own, drawn by the compositor where the
runtime places it, without changing the runtime or the SDK, and without letting the compositor know
CEF?

## Decision Drivers

* Plugins, the SDK and the runtime run unchanged: visuals, hot reload, `desk:state`, theme and
  `desk:ping` as today
* The compositor speaks the surface protocol only; per-OS buffer import is the compositor's, engine
  free
* One browser per surface: a hidden surface paints nothing, a sleeping one has no renderer, a dead
  one says so itself (the direct signal #44 waited for)
* The security boundary stays: the plugin page keeps its frame's sandbox, its CSP and the browser
  process's guard; it calls the bridge only as itself
* Stage 1's windowed desk keeps working as it is

## Considered Options

* Stand-in frames: the runtime keeps its iframes, but in compositor mode each plugin frame loads a
  stand-in that relays `postMessage` to the plugin's own off-screen browser, and the shell page
  reports where its frames are
* Remote frames in the runtime: `SurfaceHost` holds a proxy instead of an iframe, and the runtime
  sends the compositor its windows' rectangles
* Holes: plugin quads drawn under a transparent shell page that leaves holes where the frames are
* SDK bridge calls straight to the core from each surface's browser, bypassing the runtime

## Decision Outcome

Chosen option: "stand-in frames", because it leaves the runtime and the SDK untouched (the runtime
still posts to and hears from a real frame of its own), puts every CEF detail in the shell, and is
deleted whole when #53 moves the window manager to Rust.

* **Mode.** `DESK_COMPOSITOR=1` or `endue-desk-cef --compositor` opens the main window as a wgpu scene
  (`apps/desk/shell/src/compositor_window`); without it the desk is Stage 1's, unchanged. The shell
  page is an off-screen browser too, drawn over the whole window; every plugin surface is a
  windowless browser (`shared_texture_enabled`, `--site-per-process`, each on its own surface host,
  #36) drawn as quads above the page.
* **Web host** (`apps/desk/shell/src/web_host`, not `desk-web`, which stays engine-free): the surface
  protocol's web implementation. `create`/`wake` open a browser at the surface's document; `resize`
  is `WasResized` with the device scale in its screen info; `hide` is `WasHidden`; `sleep` closes the
  browser, so its renderer exits; `pace` is the windowless frame rate; `OnRenderProcessTerminated` is
  `died`, `OnLoadEnd` `ready`, the page title `title`. Every paint becomes an `attach` with CEF's
  damage, inside the paint callback.
* **Import** (`desk_compositor::Frames`, the texture import entry): on macOS the attach names the
  IOSurface by its IOSurfaceID and the compositor imports it in this process (`IOSurfaceLookup`, a
  Metal texture, once per texture id and generation), copies the damage into the surface's own
  texture and waits (`after-copy`: CEF reuses the buffer when the callback returns). On Windows and
  Linux the `cef` crate's importer copies the frame into a texture of the compositor's device first
  and the attach is `when-replaced`, until the compositor imports D3D11 handles and DMA-BUFs itself
  (#61). Without a GPU the software paint is uploaded and attached the same way.
* **Stand-ins and the relay.** A plugin surface's frame in the compositor's shell page gets a stand-in
  document from the `desk-plugin` scheme instead of the plugin. What the runtime posts to it travels
  as JSON (`__deskNative.post`, `desk.post`) to the surface's own browser, where, before the page's
  scripts run, `window.parent` is the desk (`web_host/shim.js`) and the message arrives as a
  `message` event from it; what the page posts to its parent comes back the same way and the
  stand-in posts it to the runtime. Structured clones JSON cannot carry (a `Map`, a `Blob`) do not
  cross; nothing the SDK sends needs them.
* **Bridge.** SDK calls still go through the runtime, which forwards them for the plugin it heard
  them from: its owners, command routing and sleepers stay in force until #53. A surface page's own
  `__deskNative.send` goes straight to the core as the plugin its URL names, never as the desk.
* **Sandbox.** A plugin document at the top of a browser gets `sandbox allow-scripts` in its CSP,
  the frame's sandbox (opaque origin, no popups, forms, modals or top navigation); popups are refused
  in the browser process too, and every load still passes the guard (#42).
* **Places.** The shell page reports each plugin frame's layout size, box and visible parts every
  frame something changed (`apps/desk/src/compositor-layout.ts`): what covers a frame is found
  through `elementsFromPoint` on a 24 px grid over the page and again at each part's edges, and its
  own box is cut out; see-through elements (a resize grip, a faint tint) and the frame's rounded
  corners cut nothing (`compositor-visible.ts`). The compositor turns the reports into protocol
  messages (`layout.rs`): a new frame `create`, an unloaded one `sleep` and `wake`, no visible part
  `hide`, a new revision a load of the web host's own (hot reload).
* **Recovery.** A surface's `died` is sent to the page as `desk://frame-crashed`, #44's recovery,
  which loads the window again (`wake`) or holds it (`sleep`); the target watch of Stage 1 is off in
  this mode, or one death would count twice.
* **Checks.** `endue-desk-cef --surface-probe=<import|lifecycle|many>` runs the web host and the
  import without a desk and prints its numbers; `apps/desk/shell/tests/osr_import.rs` and
  `lifecycle.rs` judge them. Development builds add `compositor_capture` (the composed frame read
  back as a PNG), `compositor_stats` and `__deskNative.pid`.

### What the macOS runs found

* A windowless browser made with `WindowInfo::hidden`, and past ten browsers hidden together, start
  no frames again once shown (`WasHidden(false)`) until they are laid out again: every show is
  followed by `WasResized`, and a surface made hidden is made shown and hidden at once.
* A windowless browser's `DoClose` must let CEF close it (returning true leaves it open for ever).
* Chromium paints an opaque backdrop under a frame whose colour scheme differs from its element's;
  the stand-in takes the plugin page's scheme, so what shows under a transparent page is what showed
  under the frame.
* Off-screen pages show overlay scrollbars where windowed frames showed classic ones; otherwise the
  composed desk matches the windowed one in the pull request's shots, but for a window's resize
  grip, which the surface now draws over.

### Consequences

* Good, because every current plugin runs as its own off-screen surface with no change to it, to the
  SDK or to the runtime, with the bridge, hot reload, recovery and the live budget as before.
* Good, because the compositor imports from the protocol's handle and never sees CEF; the import
  entry serves native surfaces (#59) as is.
* Good, because a hidden surface costs no paint, a sleeping one no renderer, and each surface's death
  is its own signal.
* Bad, because every visible plugin has two renderers in compositor mode, the stand-in's and its own,
  until #53 removes the frames; Stage 1's desk is unaffected.
* Bad, because covers are found by hit testing: what does not take the pointer (a toast with
  `pointer-events: none`) or is smaller than the grid can be drawn over, and rounded corners are
  square. The window manager in Rust (#53) draws chrome and content in one order instead.
* Bad, because input does not reach the surfaces yet (#56): the mode is a demo and a test bed.
* Bad, because Windows and Linux are compiled against, not run: #61 checks the D3D11 and DMA-BUF
  imports, Vulkan's external memory features, the probe's process checks (`ps`, `kill`) and the
  re-show quirk there.

## More Information

Issue #52 (epic #32 §4, §8, §9); ADR 0140 (the direction), ADR 0141 (the protocol), ADR 0142 (the live
budget whose sleeps this carries out), ADR 0143 (the shell), ADR 0040 (the frames' sandbox). Replaced
by the window manager in Rust (#53) and system surfaces (#55); input is #56. Its **Places** are
replaced by ADR 0151 (#81): the compositor places windows from `desk-wm`, and the page's report of its
frames' rectangles and their covers is gone. ADR 0152 (#111) drives every surface's frames from the
desk's frame clock (external begin frames), and `pace` is its share of the desk's frames too.
