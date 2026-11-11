---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0160 (each part of the desk's page has a level among what the compositor draws of its
own) and ADR 0161 (the canvas map is drawn in the system layer, under what the desk opens).

# A modal's scrim is the compositor's, and dialogs lie over the canvas map

## Context and Problem Statement

The compositor draws the desk's page above every window (ADR 0160): each part the page names whole,
and the rest of the page wherever no window lies over another's part. The canvas map (ADR 0161) was
drawn after all of it, the overlays' plugin surfaces included. Since PR #164 the page's menus, hover
cards, popovers and dialog boxes are one part (`desk.overlays`) and show whole. The QA pass of
2026-11-11 (#158 findings 4 and 5, #161 finding 10) found what that left: a dialog's scrim is the
page's own element, so it dims only what the page draws; every window's title and tools, the
windows' bodies, the dock, the bands where windows overlap, the canvas map and the talk pill stayed
undimmed around the Rename dialog, the desktops' overview and the settings, and a press there still
reached the window. The map was drawn over the settings (its footer and fields), over the studios'
Export, Remove and Save, and over the first run. Drawing the whole page above the windows while a
scrim is open would dim them, but would also lift every window's page parts (icons, tools, a shell
view) above every other window. Who draws a modal's scrim, and where does the map go?

## Decision Drivers

* A modal dims everything under it the same way, the compositor's windows and map included, and a
  press outside it is the modal's
* The windows keep their order: nothing of one window is drawn above another
* What the desk opens (settings, studios, dialogs, menus) is never covered by the map; the first run
  and the palette lie over it too
* No pixel of the page blends twice, and no new protocol beyond a part's box

## Considered Options

* The page leaves its scrims unpainted and names each as a part; the compositor fills it with the
  theme's dialog scrim above the bars and the map and under what the desk opens, and the page hears
  the pointer there
* While a scrim is open, the compositor draws the whole page above every window
* The compositor dims each window and the map itself, leaving the page's pixels as the page dimmed
  them

## Decision Outcome

Chosen option: "the page leaves its scrims unpainted and names each as a part", because one fill
over everything drawn so far dims every window, the dock, the bars and the map alike, keeps the
windows' order, and needs only a box from the page.

* **Levels** (`desk_web::sender::Level`): each part is a `Bar` (the bars, the pills, Eris, the
  notices: the page's pixels under the map), a `Scrim`, or `Front` (the settings, the studios, the
  overlays: the page's pixels above the map and every scrim). The system layer draws, back to front:
  the edge bars' surfaces, the page's pieces, the `Bar` parts, the canvas map, each scrim, the `Front`
  parts, the overlays' plugin surfaces (`compositor_window/system.rs`). Where a `Front` part's box
  meets a `Bar` part's (Eris under the desktops' overview), the box belongs to the front part: the
  page shows the dialog there.
* **The scrim** (`desk.scrim`): the page reports each `.scrim` (but the theme studio docked to edit,
  which dims nothing), the description's and a modal `<dialog>`'s backdrop, whose box is the whole
  app (`apps/desk/src/compositor-system.ts`); `apps/desk/src/compositor.css` leaves them unpainted. The
  compositor fills the box with the theme's `dialogScrim`, the spread's scrim, and the page hears the
  pointer on it, where its own scrim element lies: a press outside the dialog closes it and raises no
  window.
* **Cards** the desk opens over the windows join `desk.overlays`: Eris's proposals, the description's
  panel and the keys' hint.
* **Held by tests**: `compositor_window/system_tests.rs` (the scrim over a window, its title, the dock,
  the map, a bar and Eris, heard by the page; the dialog above it, whole where Eris's box meets it;
  the map over a bar and under the settings and the palette), `apps/desk/src/compositor-system.test.ts`
  (the scrims and the backdrop reported), `crates/desk-web/src/sender/system.rs` (the levels in
  drawing order), the app e2e `e2e/specs/system-modals.spec.ts` (around the Rename dialog, the overview
  and the settings nothing bright stays bright; each dialog shows what the page draws; a press outside
  the Rename dialog closes it and raises no window; the settings lie over the map) and
  `e2e/specs/launch.spec.ts` (the first run hears a press on the map).

### Consequences

* Good, because a modal dims the whole desk, its windows and the map included, and keeps the press
  for itself, as a modal does in a browser.
* Good, because the settings, the studios, the dialogs and the menus are never covered by the map, nor
  the first run, the palette or a permission question, which are overlays above it.
* Bad, because the compositor's scrim is a flat fill: a design system's blurred dialog scrim
  (`dialogScrimFilter`) is not blurred. The page's blur never reached the windows either.
* Bad, because a scrim the page adds under another class is not dimmed by the compositor and dims
  only the page again; it has to be named in `desk.scrim`.
* Bad, because two modals open at once are both above both scrims, where the page would dim the first
  under the second's.

## More Information

Issues #158 (findings 4, 5) and #161 (finding 10, the map over the first run). Amends ADR 0160 and
ADR 0161. Code: `crates/desk-web/src/sender/system.rs`, `apps/desk/src/compositor-system.ts`,
`apps/desk/src/compositor.css`, `apps/desk/shell/src/compositor_window/{system,draw}.rs`. No section of
`docs/ko/desk-structure.md` changes.
