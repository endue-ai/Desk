---
status: accepted
date: 2026-11-11
decision-makers: Team endue
---

Status: amended by ADR 0166: the page's open overlays (popovers, menus, hover titles, dialog boxes)
are one more part, a box each; amended by ADR XXXX: every control the page draws outside its
windows is in a part (the bottom edge's, a box each, the arrange strip, the canvas button, the safe
mode badge), and a window under an edge bar is under it whole.

# The shell runs as system surfaces the compositor places, and no plugin runs in the desk's page

## Context and Problem Statement

After ADR 0158 `desk-wm` held the window manager's state and the compositor drew every window, but the
shell page was still one picture drawn above the windows that also kept the window manager's leftovers:
each plugin pane held a stand-in frame (ADR 0149) that relayed the plugin host's messages to the
plugin's own browser and said the page's hello again whenever the page moved it, the page's own plugin
surfaces (the palette's overlay, the dock) were drawn under the page's bars whatever the page stacked
over them, and a runtime without a window host (its tests and fixture pages) still laid its surfaces
out on ADR 0040's CSS grid. Epic #32 §5 keeps what stays web as privileged system surfaces drawn in the
compositor's system layer (#55). Which surfaces are they, who calls as what, how does the plugin host
reach a plugin with no frame, and what is left of `packages/runtime`?

## Decision Drivers

* No plugin runs in, or is relayed through, a frame of the desk's page
* A system surface's caller is its window's, taken from the browser, never from the page (ADR 0012)
* The plugin host's messages (`desk:init`, `desk:state`, the theme, pings, keys) and the SDK unchanged
* Tab into and out of web and native plugins, the keys, the focus and accessibility as before (#123,
  #128, ADR 0150, ADR 0155)
* What stays web stays one runtime (39k lines of TypeScript): no rewrite in Rust, no split of its state
* The runtime's own tests and fixture pages run the paths the app runs wherever they can

## Considered Options

* One runtime page as the desk's system surface; its parts placed by the compositor; plugin pages
  reached through the shell by their surface host
* A browser per system part (the agent bar, Eris, notices, settings, the studios), each running a part
  of the runtime, the parts sharing state through the shell
* Keep the stand-in frames and draw the page whole above the windows (ADR 0158 as it was)

## Decision Outcome

Chosen option: "one runtime page as the desk's system surface", because it ends every frame in the
page and every stand-in without cutting the runtime's one state into processes, and it gives each
system part a stable id the compositor draws by.

* **System surfaces** (`desk_web::sender::System`, `crates/desk-web/src/sender/system.rs`). The desk's
  (`desk`, the main window's browser, caller `desk`): the runtime's page off screen; the palette's
  (`palette`, its window, caller `palette`); floating Eris's (`eris`, her window, the runtime caller
  `desk` for her conversation only, ADR 0121). Each caller comes from the window the browser process
  made the browser for (`Sender::in_role`), as before. The desk's page names its parts (`PARTS`:
  `desk.profiles`, `desk.desktops`, `desk.agents`, `desk.account`, `desk.rail`, `desk.bottom`,
  `desk.eris`, `desk.notices`, `desk.settings`, `desk.studios`); it reports each part's box
  (`apps/desk/src/compositor-system.ts`), and a vitest test holds the two lists to one order. The
  plugins of the system layer (the palette's overlay, the first run, a permission prompt, the dock)
  are their plugin's own browsers and call as that plugin.
* **Start-up.** `apps/desk` opens the compositor window first (`CompositorWindow::open`), then the
  system surfaces in `System::ALL`'s order: the desk's page in it (`compositor_window/page.rs`), the
  palette's window, Eris's.
* **The system layer** (`compositor_window/system.rs`), above every window and below the compositor's
  own overlays, back to front: the edge bars' plugin surfaces, under the page's bars as the page stacks
  them; the desk's page wherever no window lies over another's part the page draws (`Plan::page`, ADR
  0151), and each named part's box whole, whatever lies under it, so a bar over a window is never cut;
  then the overlays' plugin surfaces (`layer: overlay` in the report), above it all, as the palette
  comes over the whole shell. The pieces never overlap, so no pixel of the page blends twice. A part
  takes the pointer wherever it is drawn, a window included; the rest of the page outside windows, but
  where an edge bar's surface lies under it, which then hears its own presses. An overlay not shown yet
  is made at the app's size rather than at the 1×1 its hidden section measures: a windowless browser
  made that small and grown while hidden never painted once shown (the palette's did not).
  `compositor_stats` says what the system layer drew, back to front (`system.order`).
* **No frames in the page.** The runtime's `SurfaceHost` makes each section with a `SurfacePages`
  (`packages/runtime/src/pages/`). In the app it is `remotePages`: the section holds the surface's
  place (`pages/place.ts`, a box with `data-surface-host` and two Tab edges, which never paints), and
  each surface has one port, the `Window` the plugin host posts to and hears from, so plugins are still
  told apart by the source of a message (ADR 0012). A port's `postMessage` is
  `__deskNative.post(text, host)`; the shell's relay (`web_host/relay.rs`) sends it to that surface's
  browser (`shim.js` gives it `window.parent`, as before) or a native plugin's process, and what a
  surface's page posts to its parent comes to the page as `__deskNative.onSurface(host, text)`
  (`renderer.rs`'s `desk.surface`), a `message` event from the surface's port. A page loaded again
  after an unload gets a new port, as a frame put back got a new window; the place counts its loads
  for the compositor's report. A desk without the compositor (the runtime's unit tests, fixture pages
  and dev page) uses `framePages`: sandboxed frames of its own page, as desk-wm runs as WebAssembly
  there (ADR 0158).
* **Deleted:** `web_host/stand_in.{rs,html}`, the relay's greetings (the hello said again for a moved
  stand-in and the init it kept), its queue for a stand-in still loading and `StandInLoads`; the
  stand-in's colour-scheme message (no frame paints a backdrop now). The scheme's stand-in reply
  becomes a refusal: a plugin document asked for as a frame of the desk's page gets 403
  (`web_host/top.rs`), so no plugin ever runs in the system surface's process.
* **Tab** (#123, #128) crosses a place as it crossed a stand-in: the page's Tab reaching an edge posts
  `desk:surface-enter` to the surface (the shim focuses its first or last control; a native plugin
  hears `focus.enter`, `native_host/page.rs`), the focus rests on the place, whose host the compositor
  gives the keys to (`compositor-focus.ts`); a surface tabbing past an end (`OnTakeFocus`,
  `focus.leave`) comes to the page as `desk:surface-leave`, which rests on that edge and asks the shell
  to press Tab once more in the page (`desk:surface-tab`). A screen reader's focus on a surface focuses
  its place (`compositor_window/a11y.rs`).
* **What `packages/runtime` is:** the system surface's runtime. Its policies, commands, keymap, plugin
  host, settings, profiles, session record, shell parts (bars, Eris, notices, menus, settings, studios)
  and the window parts it draws in desk-wm's windows; no window management (ADR 0158) and no frames
  in the app. ADR 0040's grid is deleted: `layout.ts`, the cells, `moveSurface`, `layout()`, the
  `desk.layout` key and the session record's `layout` (an older record's is read as nothing). A runtime
  without a window host shows its surfaces side by side in the order they opened (`.desk-surfaces`).
  `edges.ts` stays where it is used: the dock's bottom bar in the app, and every edge without a window
  host.
* **Fixtures.** `packages/runtime/e2e/fixture` mounts the runtime as the desk's system surface, as the
  app does, without the compositor: desk-wm as WebAssembly (`wm-host.ts`), surface pages in frames, no
  grid.

### Consequences

* Good, because no plugin runs in or relays through the desk's page: a plugin's messages reach the
  runtime only from its own browser, by the host only that browser has, and a split, the drawer or a
  desktop switch moves only a place, which loads nothing, so nothing says hello twice.
* Good, because the palette's overlay and the first run come over the page's bars, a press on them
  reaches them, and the dock hears its own presses where the page's bars do not lie over it.
* Good, because a bar, Eris or a notice over a window is drawn whole and takes the press there.
* Good, because the runtime holds no grid and no window manager: its fixture pages run desk-wm and
  their surfaces as the app's runtime does, but for frames.
* Bad, because the desk's parts are boxes: where a bar is see-through, a window part the page draws
  under it shows through above a window that should hide it, and a menu or popover that leaves its
  part's box is drawn with the page's pieces, cut where a window lies over another's part.
* Bad, because the system parts are one browser: a busy runtime still stalls every bar together, and
  splitting a part into a process of its own needs its state to cross the shell.
* Bad, because the runtime's tests and fixture pages still show plugins in frames: the remote path is
  tested in `pages/remote.test.ts` and the app e2e, not by the runtime e2e.
* Bad, because a page load is a desk start: a runtime page that loaded again would find its plugins'
  pages already greeted; nothing loads the page again today.

## More Information

Issue #55 (epic #32 §5, §6). Amends ADR 0012 (the scheme refuses a plugin frame in the desk's page),
ADR 0040 (the grid is gone), ADR 0149 (its stand-ins and relay), ADR 0150 (Tab and the focus through a
surface's place), ADR 0151 (the page's report: places, layers and parts), ADR 0156 (what the page
still kept), ADR 0158 (its last Bad consequence). Code: `crates/desk-web/src/sender/system.rs`,
`apps/desk/shell/src/compositor_window/{page,system,report,checks,hosted}.rs`,
`apps/desk/shell/src/web_host/{relay,top,shim.js}`, `apps/desk/shell/src/{renderer,host,client,window}.rs`,
`apps/desk/shell/src/native_host/page.rs`, `apps/desk/src/compositor-{surfaces,system,desk,focus}.ts`,
`packages/runtime/src/pages/**`, `packages/runtime/src/{surfaces,runtime,edges}.ts`,
`packages/runtime/src/policies/session.ts`. Tests: `crates/desk-web/src/sender/system.rs`,
`compositor_window/system_tests.rs`, `web_host/{relay,top}.rs`, `packages/runtime/src/pages/remote.test.ts`,
`apps/desk/src/compositor-{system,desk,focus}.test.ts`, `e2e/specs/system-surfaces.spec.ts`, the
`a11y`, `native-plugin`, `ime`, `dnd` and `windows-*` specs. No section of `docs/ko/desk-structure.md`
changes.
