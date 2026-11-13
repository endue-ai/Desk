---
status: accepted
date: 2026-11-13
decision-makers: Team endue
---

Amends ADR 0153 (what the page draws of a window is laid out in that window's own page, not cut
out of the page's texture), ADR 0160 (the desk's page draws no window; the runtime stays one page
and one state) and ADR 0166 (its paint-following cut is left for the system layer's parts and for a
window whose own page has not painted yet).

# Each window draws from a page of its own

## Context and Problem Statement

The desk's page (the system surface, ADR 0160) drew part of every window in its one texture: each
title bar's icon and tools, split panes' headers, and the whole content of the windows the runtime
shows itself (local agents' screens, endue agent and space cards, the directory's agents, Calendar,
Tomorrow, Notes, the launcher, Keys). The compositor cut those pieces out of the page's texture by
place. The page's picture lags the window manager by one to ten frames; ADR 0166 follows it by the
paints' damage, which narrows the gap but cannot close it, and a page that stops painting (#157)
leaves its cuts frozen. On the person's desk on 2026-11-13 a drag left trails and another window's
pixels in the moved window, and after the app window was resized the desk's page stopped for good,
every window it drew frozen with it. How does every window get a texture of its own while the
runtime keeps one script and one state?

## Decision Drivers

* No texture holds the pictures of two windows, and the desk's page holds none (#227)
* A window moves, glides and changes place in the stack without a repaint
* One runtime, one state (ADR 0160): its views keep calling it in-page, none is rewritten
* Input as before: the title bar's gestures and tools, focus following a press, typing into a
  window's own views, the desk's keys wherever the keyboard is
* No patch to CEF or Chromium

## Considered Options

* A same-origin popup per window, opened by the desk's page, in which the runtime builds the window's
  DOM; CEF renders it off screen into a texture of its own
* Lay the windows out apart in the page (an atlas) and cut each from its own tile: a move repaints
  nothing, but one texture still holds them all, and a page that stops stops every window
* A browser per window running a part of the runtime: ADR 0160 turned it down, the state splits
* The runtime's views as plugins: a rewrite of every view onto the bridge, and the title bars'
  icons and tools still the page's
* Draw the title bars natively and keep the views in the page: the views are still cut

## Decision Outcome

Chosen option: "a same-origin popup per window", because each window gets its own widget, frame sink
and texture while the runtime's one script builds the same DOM it built in the page, with its state
where it was.

* **The runtime** (`packages/runtime/src/surface/window-pages.ts`): `windowPages(page, layer, open)`
  opens a page named `desk-window:<window id>` (`PAGE_NAME`) for each window `Surface.ts` lays out
  once the window manager placed it, copies into it the page's root (its classes and the theme's
  tokens), its style sheets and the windows' layer's ancestors, keeps them in step, and mounts the
  window's section at its top left, at the window's size. The page closes with its window. Where no
  popup opens (the runtime's tests, its fixture pages, a browser), the window stays in the page. The
  app opens the pages 50 ms apart (`spacing`): fourteen opened in one burst over the plugins' first
  frames stopped the window in use's page at almost every start (#157's stall, 3 s later reloaded by
  the shell's watch); one, or fourteen spaced, never did. A window waits in the desk's page until its
  own opens. One focus is kept across the pages, as one page had: the page the focus enters takes it
  from the others, so no two fields show a caret. A plugin's section stays in the desk's page while
  its window lies in a page of its own: its place never paints and only holds the plugin's spot in
  the focus order (ADR 0160), so Ctrl+Tab to a plugin, Tab into and out of one and the focus the
  compositor's keys follow stay the desk's page's, as before. Each window's places sit in a group
  of their own (`surface/anchors.ts`), led by a stop that stands for the window's chrome and
  carries its name: Shift+Tab out of a plugin stops there, and Tab past one at the next window's,
  as when its tools came before its panes in the page; side by side, Shift+Tab out of one plugin
  entered another window's. The stop hands nothing on to the window's page, whose tools took the
  focus from the desk's page only sometimes and whose Tab could not come back.
  A press's point there counts from the window's corner: `host-gestures.ts` adds the window's place,
  and pans on Shift where the canvas's handler cannot hear the title bar; `shell/drag.ts` reads the
  handle's document when pressed; each page listens for the desk's keys (`listenForShortcuts`).
* **The app** (`apps/desk/src/desk.ts`, `compositor-focus.ts`): the shell's `window.open` is the
  opener; each window's page reports where its focus rests, as the page does: a field of the
  window's own gives its page the keys (`window:<window id>`), a plugin surface's place there that
  surface, nothing of its own leaves them with the window in use, and a press there is answered.
* **The shell** (`apps/desk/shell/src/web_host/window_pages.rs`, `client.rs`, `app.rs`): with
  `--disable-popup-blocking` the shell decides every popup: the desk's page's popup named
  `desk-window:<id>` is that window's page, windowless with a shared texture on the desk's frame
  clock, transparent, its client one that answers no bridge call and relays no post; any other popup
  opens only on a press, as Chromium's blocker had it, and a plugin's never. The web host keeps it as
  surface `window:<id>`, lays it out at its window's size and hides it while its window is not drawn
  (`place_window_pages`, after each look). Its view kept Chromium's opaque canvas whatever
  background its settings named, which hid the frame the compositor draws under it (its border, the
  focused one's colour): the shell clears the page's base colour through the DevTools protocol as
  it takes the page. While the compositor gives it the keys it has the
  engine's focus through the DevTools protocol's focus emulation, and loses it with them: an
  off-screen popup's widget never takes it from `SetFocus`, and a page without it shows no caret and
  draws a selection greyed. Emulation on every page all the time closed any plugin's open popup (a
  select's list never showed), which is why it is the keys' page's alone.
* **A window's page that loses its frames is replaced** (`web_host/popup_room.rs`, `revive.rs`,
  `window_pages.rs`). A plugin's popup hides every other browser for a moment so its first frame
  is not evicted (#156), the windows' pages with them: Chromium keeps the frames of five browsers
  and every window's page is one. After a popup, five to seven of fourteen windows' pages came
  back without frames for good (begin frames on every desk frame, no paint, no frame callback, no
  press heard), and no later show, resize, delay or load brought one back. So the room looks 500
  ms after it shows them again: a window's page that painted before and nothing since is closed,
  as is one the #157 watch finds stalled (a load would leave the runtime's page blank). The runtime
  hears the page go (`pagehide`), gives the window back to the desk's page and opens a page anew;
  the compositor draws the window from the last page's picture until the new one paints, the
  pointer meanwhile to the desk's page, and drops a window page's texture with its window.
* **The compositor** (`compositor_window/draw.rs`): a window whose own page painted is drawn from that
  texture over its frame, cut to the texture and never stretched, its plugins' surfaces above it,
  and nothing of it from the desk's page; until then it is drawn as ADR 0166 has it. Its page is a
  target of its own, and a plugin surface in it is heard by its page too (`Targets::set_page_of`), so
  its DOM finds the pane and the window a press lands in; its left button only, as a right press
  there is the plugin's context menu, which the window's page would open beside it. The router
  treats `window:` surfaces as the
  page's own (`PointerSettings::pages`): a press on one waits for the page's answer, the desk's keys
  reach its keymap there, and a pane the page draws in use is its window's page.
* **The app window's resize** (`compositor_window/page.rs`) tells the desk's page's browser the
  screen only for a new scale, as ADR 0170 has a plugin's: the path it left told it with every size.

### Consequences

* Good, because a move, a glide or a raise repaints nothing: a window shows only its own pixels and
  leaves nothing behind, at any speed.
* Good, because a desk's page that stops painting leaves the windows drawing and moving with their
  own pictures; only the bars, Eris and the menus would stand still.
* Good, because the runtime's views are unchanged: the same DOM, script and state.
* Good, because a window's corners are round in the app, where the desk's page cut them square.
  Their grips now lie whole over the rounded corner (`surface.css`): the section clipped them to
  it, so a press in a corner's outer pixels, where the compositor shows the resize cursor, panned
  the desk instead (on `main` too).
* Bad, because each window has a browser more: in the desk's page's renderer process, a widget, a
  frame sink and a texture at the window's size; and its first paint waits for its page's style
  sheets (from the memory cache). A start with many windows takes their pages in 50 ms apiece:
  until its page opens a window is cut out of the desk's page as before.
* Bad, because the windows' pages share the desk's page's main thread, as their DOM did: a long task
  in the runtime still holds every window's changes.
* Bad, because a plugin's popup costs some windows a new page each time it opens: a browser closed
  and another opened for each, 0.5 to 1 s after the popup, while their windows show their last
  picture. The cause is in Chromium's frame eviction and CEF's off-screen view, out of the desk's
  reach; fewer browsers shown at once would make it rarer.
* Bad, because code that reads `document` for a window's DOM must read the element's own document,
  and an `instanceof` across the two realms holds for the runtime's own elements (made in the page)
  but not for events, which the window's page makes.

## More Information

Issue #227, after the person's report of 2026-11-13. Amends ADR 0153, ADR 0160 and ADR 0166; ADR
0170's resize guard now covers the desk's page too. Code: `packages/runtime/src/surface/{window-pages,
anchors,Surface,host-gestures}.ts`, `surface.css`, `packages/runtime/src/shell/{drag,dom,Desk}.ts`,
`apps/desk/src/{desk,compositor-focus}.ts`, `apps/desk/shell/src/web_host/{window_pages,client,
popup_room,revive}.rs`, `apps/desk/shell/src/{client,app}.rs`,
`apps/desk/shell/src/compositor_window/{draw,input,steps,compose,composed,page}.rs`,
`crates/desk-compositor/src/input/{pointer,targets,follow,keys,router}.rs`. Tests:
`packages/runtime/src/surface/{window-pages,anchors,host-gestures}.test.ts`,
`packages/runtime/e2e/shell-interactions.spec.ts` (a corner's outer pixel),
`crates/desk-compositor/tests/input_pages.rs`, `apps/desk/shell/src/compositor_window/draw_tests.rs`,
`apps/desk/shell/src/web_host/window_pages.rs`, `e2e/specs/window-pages.spec.ts`, and the app e2e
that drive windows (`popups`, `a11y`, `native-plugin`, `editing`). No section of
`docs/ko/desk-structure.md` changes.
