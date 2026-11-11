---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Extends ADR 0149 (web surfaces render off screen) and ADR 0160 (the desk's system surface).

# A page's popup widgets are drawn over its surface, the other browsers making room for them

## Context and Problem Statement

A `<select>`'s list and the date, time and colour pickers are not part of their page's paint. In an
off-screen browser Chromium paints each as a widget of its own (CEF's `PET_POPUP`) at a place in the
view it names (`OnPopupShow`, `OnPopupSize`) and hands it the pointer the view gets there and the
keys while it is open. The shell dropped those paints, so no list or picker ever showed: the control
took the focus, keys changed its value blind, and the Escape that closed the unseen picker was lost
(#156, item 2; 13 of the first 60 controls in Settings, 48 of the design tuner's 54).

Drawing them was not enough. CEF's off-screen view embeds a new popup's first surface while
Chromium's frame evictor still counts it as hidden (`ShowWithVisibility` marks the view showing,
synchronises it, and only then shows its frame host), and Chromium keeps at most five browsers'
frames, never evicting a shown one. The desk shows more browsers than that, so every popup's frame
was evicted the moment it was embedded, its renderer never got a surface id, and it never painted
(on a desk with four browsers or fewer it did). Nothing in CEF's API reaches a popup's view later.

## Decision Drivers

* Every page's popups, the desk's own and each plugin's, with no change to any page
* Drawn where the page puts them, above what their window shows, the pointer on them theirs
* The compositor keeps seeing surfaces, not CEF
* Nothing a person sees changes when room is made

## Considered Options

* Draw each popup's texture over its surface in the compositor; make room for its first frame by
  hiding the host's other shown browsers for that moment
* The same, composited into the surface's own texture in the shell
* Chromium's in-page picker for selects (`appearance: base-select`) in the sheet every page links
* A newer or patched CEF

## Decision Outcome

Chosen option: "draw each popup over its surface, and make room for its first frame", because it
reaches every popup of every page, keeps the page's look, and needs neither CEF nor a page to change.

* `web_host/render.rs` and `web_host/popup.rs`: a popup's paints attach as a surface of their own,
  `<surface>#popup`; its place goes to the compositor through `SurfaceSink::popup`, a call beside
  the protocol (no `specs/surface` message yet). Closing it, its browser's death and the surface's
  destruction drop its frames.
* `compositor_window/draw_popup.rs`: a plugin's popup is drawn in its window over its pane, cut to
  the pane; the desk's page's over everything the page lays out (a list may reach past its dialog).
  The pointer on it goes to the surface at that point, where CEF hands it to the popup; keys go to
  the focused surface, whose engine hands them to the open popup. A press elsewhere in the page,
  Escape, or a focus that moves to another surface closes it, as the engine does.
* `web_host/popup_room.rs`: when a popup opens (CEF calls `OnPopupShow` before it shows the popup),
  the host's other shown browsers are hidden, which lets Chromium evict their frames instead (the
  compositor keeps its own copy of each, so nothing changes on screen), and on the next turn of
  CEF's loop each is shown, laid out and painted again, as a surface shown after others is.

### Consequences

* Good, because every select, date, time and colour picker in every page shows and is used by pointer.
* Good, because the compositor's part is a node over the surface it already draws, unit tested.
* Bad, because each popup that opens repaints every other shown surface once, and their pages see
  `visibilitychange` twice in quick succession.
* Bad, because a popup is cut to its window's pane: a picker taller than the window shows its top.
* Neutral, because the macOS colour picker in this CEF build is Chromium's HTML one, a popup like
  the others; a build that opened the system's colour panel would need its own answer.

## More Information

Issue #156 (draft 02 item 2), the QA pass of 2026-11-11 (O7, F11, F12, F18, F22). A trace of the
popup's renderer showed its layer tree waiting for a surface id (`defer_begin_main_frame`), and the
browser's `DelegatedFrameHost::EmbedSurface` with an invalid id right after the first. When CEF
shows a popup's frame host before it synchronises it, `popup_room.rs` can go. Tests:
`web_host/popup.rs`, `compositor_window/draw_popup.rs`, `compositor_window/draw_tests.rs`,
`web_host/popup_room.rs`, `e2e/specs/popups.spec.ts`.
