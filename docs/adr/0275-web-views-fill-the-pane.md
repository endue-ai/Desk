---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# Web views can fill the pane

## Context and Problem Statement

The Browser's toolbar and its web view paint in separate CEF browsers (ADR 0216). During a
quick resize the Desk can draw a new pane before the plugin reports its web box or the remote
page paints at that size. The old box and paint leave a gap to the right or below the page.

## Decision Drivers

* The Browser's page follows its pane on every presented frame after its first paint.
* Plugins can still place a fixed-size view at an arbitrary point in their surface.

## Considered Options

* Wait to present the window until the toolbar and web view have painted at the new size.
* Let a plugin anchor its web view to the pane edges and fit its latest paint to that box.

## Decision Outcome

With `web.place`'s optional `fill` flag, a view begins at the supplied coordinates and follows the
pane's right and bottom edges. The Browser reports the start below its toolbar. CEF reflows the
page using the plugin's requested size. The compositor uses the pane's displayed size and fits
the latest web paint to it, mapping input to the paint's coordinates. Popups follow their anchor
and keep their native sizes.

### Consequences

* The window can keep resizing while the remote page works on a new layout.
* During that interval the previous page image can be temporarily scaled. The freshly reflowed
  paint takes its place when it arrives.

## More Information

Issue #426. This extends the web view placement in ADR 0216.
