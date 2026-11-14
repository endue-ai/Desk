---
status: accepted
date: 2026-11-14
decision-makers: Team endue
---

# A plugin shows a live web page in a web view of the desk's

## Context and Problem Statement

A person wants to surf the web in a window of the desk (#273): an address field and a live page, on the
canvas beside their other windows. No plugin can show one. A plugin's page reaches nothing but the
desk's schemes: the browser process refuses every `https:` load (#42, `desk_web::guard`), and a plugin
reaches the network only through `net.fetch`, which gives it bytes, not a page that runs. The Web
plugin (`endue.web`) shows saved pages with nothing run. A site framed in a plugin's page would be
refused by most sites (`X-Frame-Options`, `frame-ancestors`), and the frame would sit inside the
plugin's renderer with the bridge beside it. How does a plugin show a page of the open web, with
scripts, sign-in and video, without that page reaching the desk?

## Decision Drivers

* A real page: Chromium as it is, not a reader
* The page gets nothing of the desk: no bridge, no desk scheme, no file, no cookie of the desk's pages
* Deny by default (ADR 0012): a plugin shows only the sites a grant covers
* A window like every other: on the canvas, moved, snapped and put away by `desk-wm`, drawn by the
  compositor (ADR 0205)
* The plugin keeps the folder format and the public SDK (rule 9): its toolbar is its own page
* No patch to CEF or Chromium, and the motion gate stays green (ADR 0208)

## Considered Options

* A web view: a browser of its own for the page, which the desk draws over the plugin's surface
* The page in a frame of the plugin's page, with the guard opened for it
* The page in an OS window of its own, the plugin holding only the address (a windowed browser)
* A reader: fetch the page with `net.fetch`, strip its scripts and draw what is left

## Decision Outcome

Chosen option: "a web view", because it is the only one that keeps the page a real one, keeps it out of
every desk page's process and origin, and keeps the window on the canvas.

* **Bridge** (`specs/bridge/v0/web.schema.json`). `web.open` opens a view in the calling window, on an
  address or empty, hidden until `web.place` gives it a box in the caller's surface (CSS pixels from its
  top left); `web.load`, `web.go` (back, forward, reload, stop), `web.focus` and `web.close` act on it;
  `web.changed` tells the window that opened it its address, title, load and where its history can go,
  an address it refused, and that it closed. A window has one view.
* **Permission.** `web:browse`, with optional `hosts` (absent covers every http and https site). The
  core refuses an address outside the scope's hosts, and the shell asks the core
  (`Core::web_allows`) before a view's own page goes anywhere by itself, a link or a redirect; what a
  page embeds from other hosts loads, as on the web. The core owns each view per caller: another
  caller's id is `not_found`, and a view ends with its plugin and with the grant that covered it.
* **The runtime names the window.** Every window of a plugin calls as the plugin (ADR 0212), so the
  core cannot tell which window asked. The runtime, which forwards the call, sets `surface` in
  `web.open` to the calling window's surface host, whatever the plugin sent, and routes `web.changed`
  to the window whose call opened the view (`owners.ts`).
* **The shell** (`web_host/web_views.rs`, `web_client.rs`, `web_rules.rs`). A view is a windowless
  browser on the desk's frame clock, its paints attached as surface `web:<surface host>`, which is no
  plugin surface's host: the relay and the bridge's sender never read it as one. Its client answers no
  process message; the renderer leaves `__deskNative`, the ask for frames and the shim out of its
  browser's frames, and out of any frame whose document came from http or https (`renderer.rs`); every
  load passes `web_rules::loads` (the web's schemes, `data:`, `blob:`, an empty frame); its cookies,
  cache and storage live in a request context of its own under `web/`. No window opens (what a press
  asked a new one for loads in the view), script dialogs are suppressed, file choosers, permission
  prompts and media access are refused, and nothing is downloaded.
* **Frames.** A remote page gets no script of the desk's, so it cannot ask a resting desk for frames
  (#134). Its surface never rests instead: with nothing painted or heard it keeps the slow frames, ten
  a second (`Pacing::restless`), so a change it makes on its own is painted within one, and it goes on
  every frame as any surface does while it paints or hears input. Chromium's back/forward cache is off
  (`features.rs`): a page it swapped back in got no frame at all under external begin frames (CEF
  156), so a step back loads the page again.
* **The compositor** (`compositor_window/draw_web.rs`, `web.rs`). The view's texture is drawn over its
  plugin's pane at its box, cut to the pane and to what the texture holds; it shows while the plugin's
  surface is drawn live and hides with it; a press on it is heard by its window's own page too (ADR
  0201), so the window comes forward. It is not counted by the live budget: it ends when its window's
  surface sleeps, is destroyed or moves out to an OS window (#235), where the plugin says the page
  shows in the desk only.
* **Keys.** The desk gives the keys to a plugin's surface; a view stands in for it while it has them
  (`WebHost::web_stand_in`): a press in the view or `web.focus` gives them, a press on the plugin's own
  surface takes them back. The desk's chords run from the view as from the plugin (the runtime hears
  them as its surface's).
* **The Browser** (`plugins/browser`, `endue.browser`): the toolbar, the address typed (a host gets
  `https://`, words are searched for), and the address kept over a sleep.

### Consequences

* Good, because a page of the open web runs as it would in a browser, and a plugin made by anyone can
  show one under a grant the person reads
* Good, because the page shares no process, origin, storage or script with any desk page: what it can
  reach is what a site in a browser can
* Good, because the window is a desk window: no second window system for one plugin
* Bad, because a view at rest takes ten begin frames a second where a plugin's surface takes none
* Bad, because a step back loads the page again instead of showing it at once
* Bad, because the view is not in the accessibility tree yet (a pane exports one surface, ADR 0155),
  and its window cannot move out to an OS window with its page
* Bad, because it is a first version: no tabs, downloads, find, zoom, printing or permission prompts,
  and a page that needs a new window gets its address in the same view

## More Information

Checked on the running desk (headless, a page served on this machine and `https://endue.ai/`): the page
painted and followed its window's size, a link went on and the address field followed, back returned
and painted, text typed into a field of the page arrived with the input method allowed, the wheel
scrolled, a list opened over the page and took a choice by key, Mod+K ran from the page, a link for a
new window loaded in the view, and closing the window ended the view and its renderer. Two things the
check found are in the decision above: the back/forward cache, and a sweep of ended views' pictures that
took an open list's picture with it (`web_swept` leaves `#popup` pictures to their view). The app e2e
found a third: a view opened as its plugin started got no browser, since CEF makes none at once in a
request context that is still starting, so a view's browser is made without waiting and joins its view
when it comes (`web_created`), with the address it was sent meanwhile. The remote page read
`typeof __deskNative` as `undefined`. Tests: `docs/qa/TESTING.md`.
