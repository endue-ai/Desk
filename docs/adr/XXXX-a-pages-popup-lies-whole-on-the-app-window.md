---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0188 (a page's popup widgets are drawn over its surface): its "a popup is cut to its
window's pane".

# A page's popup lies whole on the app window, above the windows and under the desk's own layer

## Context and Problem Statement

On a fresh desk the first windows are 328 × 211 at 1280 × 800 (#193), so a plugin's pane is
326 × 169, and its date (281 px tall), time (260) and colour (252) pickers were cut at the pane's
bottom: the lower weeks, Clear and Today, the lower hours and the colour picker's fields could not
be reached until the window was made bigger (#156, B6b). Chromium places a popup in the screen its
view reports, and each view reported itself, so a picker taller than the pane was squeezed into
it, over its field; and the compositor cut a plugin's popup to its pane (ADR 0188). How does a
popup in a small window show whole and work, as on a desktop?

## Decision Drivers

* A popup lies below its field, or above it with no room below, past its pane where it is larger
* It is drawn above every window, and under the desk's bars, Eris, notices, dialogs and scrims
* The pointer on its parts outside the pane is the popup's, never the window under them
* No resize in flight is laid out again past CEF's hold (ADR 0170); no change to any page or CEF

## Considered Options

* Report the app window as each view's screen, the view at its place in it, and draw the popup
  whole where Chromium puts it
* Report a screen large enough that a popup always fits below its field, and let the compositor
  flip it: the compositor does not know the field's box, and a select's list sized to that screen
  grows past the app window
* Keep the view as the screen and let the compositor move a cut popup: Chromium has squeezed it into
  the pane by then, over its field

## Decision Outcome

Chosen option: "report the app window as each view's screen", because Chromium then places every
popup as a desktop browser does, and the compositor only draws what it was told.

* `web_host/popup_screen.rs`, `web_host/render.rs`: a view's rect is its pane's place in the app
  window (`GetViewRect`), its screen the app window with the desk's free area as the available
  rect (`GetScreenInfo`; `desk_wm`'s `Bars::free`, as a desktop leaves out its menu bar and dock),
  so no popup is placed under the rail, the agent bar or the dock. The compositor says where it draws each surface at each layout
  (`WebHost::placed`); a browser hears it through `NotifyScreenInfoChanged` once its view has
  rested there 150 ms, painted at its size and since it was last told, with no popup open
  (`WebHost::tell_screens`), and the handler answers what it was told, so the place CEF hands back
  is in the view Chromium placed the popup from. A page told its screen gets desk frames, so it
  paints at the surface id that came with it, which ends CEF's hold on the view's bounds.
* `features.rs`: Chromium's `LimitPopupWidgetHostPosition` (crbug.com/424995036) keeps a popup's
  top at or below its page's view, under a browser's address bar; it is turned off, so a picker low
  in the app opens above its field.
* `compositor_window/draw_popup.rs`: a window's popup is drawn after every window and before the
  system layer, whole, kept inside the app window (moved in where a screen told late puts it past
  an edge); the page's own pieces leave out its box (`system.rs`), its bars and parts are drawn
  over it. A system surface's popup goes over its layer, the page's over everything.
* `compositor_window/popup_input.rs`: a press on a popup, and what follows it until the last button
  goes up, goes to its surface only: neither the window manager nor the page hears it, which would
  take a press on the popup's part over another window for that window (focus it, close the popup)
  or for its edge (resize it). Nor does the page hear the pointer move over a popup. Each window's
  popup is an area of its own above the windows the router knows (ADR 0192's window areas), so a
  press on its part over another window is its surface's, and the keys stay where they are.

### Consequences

* Good, because a picker or a list opens whole in a window of any size, under its field or above
  it, and every part of it takes the pointer (`e2e/specs/popups.spec.ts`).
* Good, because the desk's own layer stays above every popup, so no page's popup covers a bar, a
  notice, a dialog or a permission prompt, which is what the limit Chromium keeps guards for a
  browser's address bar.
* Bad, because a window that comes to rest somewhere new tells its page once, which lays the page
  out again (CEF gives it a new surface id): after a pan of the canvas every page in sight paints
  once.
* Bad, because a popup opened within 150 ms of its window moving is placed from where the window
  was; the compositor moves it inside the app window, but it may cover its field.
* Neutral, because each page's `screen` is now the app window (1280 × 800, available between the
  bars) and its `window.screenX`/`screenY` its pane's place in it, where the screen was the pane
  and the place 0.

## More Information

Issue #156 (draft 02 item 2), B6b. CEF holds a view's bounds while a resize it started is in
flight (`CefRenderWidgetHostViewOSR::ResizeRootLayer`) until the page paints, and sends the
renderer its screen rects only on a screen change, so a second change told before a paint never
reached the page: the reason for "painted since it was last told". Tests: `web_host/
popup_screen.rs`, `compositor_window/draw_popup.rs` (`draw_popup_tests.rs`),
`compositor_window/popup_input.rs`, `features.rs`, `e2e/specs/popups.spec.ts`.
