---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Extends ADR 0146 (chrome text and the token table) and ADR 0160 (the desk's system surface).

# A page's hover titles are drawn by the compositor, in the theme

## Context and Problem Statement

Since the compositor became the only desk (#83) every page, the desk's own and each plugin's, is an
off-screen Chromium browser, and an off-screen browser draws no tooltip: Chromium hands the title
under the pointer to the embedder (`CefDisplayHandler::OnTooltip`) and leaves the drawing to it. The
shell did not handle it, so no `title` ever showed (#156, item 3): the six tools of every window's
title bar, the gear, Inbox and account, the desktop buttons, the agent bar's warning whose reason is
only in its `title`, and every plugin's icon-only buttons explained nothing. The desk's page also
never told the window its CSS cursor (its display handler had no `OnCursorChange`), so the pointer
stayed an arrow over its buttons and its resize grips. Who draws a hover title, where and when, and
how does it reach whoever draws it?

## Decision Drivers

* Every page's `title` shows, with no change to any page; community plugins get it as they are
* In the desk's own look, in the theme in force, above everything a window or the desk draws
* The usual timing: after the pointer rests, gone on a move or a press
* The desk's page labels some controls itself (the rail's and the arrange strip's `.tooltip`, drawn
  in the `desk.overlays` part, ADR 0160): none is labelled twice

## Considered Options

* The compositor draws it: the web host hands each page's title to the compositor beside the surface
  protocol (`SurfaceSink::tooltip`), which shows it near the pointer in the theme's tooltip tokens
* The desk's page draws it: the shell posts the title and the pointer's place to the runtime, which
  shows a `.tooltip` element of its own in its `desk.overlays` part
* A `tooltip` message in the surface protocol (`specs/surface/v0`), so native surfaces could say
  theirs too

## Decision Outcome

Chosen option: "The compositor draws it", because the compositor alone knows which surface the
pointer is for and draws above every layer (the windows, the page's system layer, the canvas map),
and it already sets chrome text in the theme from the token table (ADR 0146).

* **How a title comes** (`web_host/client.rs`, `client.rs`, `web_host/routes.rs`): each surface's
  `OnTooltip`, and the desk's page's, hands its text to the web host, which says it to the compositor
  (`SurfaceSink::tooltip`, an empty text when the pointer left the titled element). The desk's page's
  `OnCursorChange` goes the same way as a plugin surface's, as its `cursor`.
* **Who names the cursor where**: over a window's grips and its title bar, and while a gesture runs,
  the window manager (ADR 0183); elsewhere the surface the pointer is for, the desk's page included.
  The page says no cursor of its own for the chrome the window manager owns (`compositor.css`:
  `.surface-resize` and `.surface-title` are `default` in compositor mode): a page's cursor reaches
  the window a frame after the pointer moved, so a grab hand it named for a title showed for a frame
  over the window's body the pointer moved to next.
* **When it shows** (`compositor_window/tooltip.rs`): once the pointer has rested `DELAY` (500 ms,
  Chromium's own tooltip's) on the surface whose page said it, counted from the last move or from the
  title's arrival. Only the surface the pointer is for counts: the desk's page hears the pointer over
  every surface too (the router's underlay) and says the titles of what lies under them in its DOM
  (a window's body carries its name as a `title`). A move farther than `SLOP` (4 CSS px) puts it away
  until the pointer rests again. A press or a key puts it away until the pointer, let go, moves
  farther than `SLOP` from where it let go, as Chromium's tooltip stays away after a click; not
  until the page says another title, because the page says the pressed element's title after the
  press, and a window dragged by its title has its page catch up with the pointer past its grips
  and its body, so a title would show where the window was dropped. The wheel, the pointer leaving
  the window and the window losing the focus put it away. The event loop wakes for the rest's end
  (`clock.rs`).
* **How it looks** (`compositor_window/tooltip_draw.rs`, `ChromeTheme::tooltip`): the shell's
  `.tooltip` look from the token table: `tooltip`, `tooltipText`, `tooltipRadius`, `tooltipShadow`,
  `space1` and `space2` of padding, `textXs` on 20 px lines in `fontSans`. It is sized to the title as
  the compositor's fonts set it (`Fonts::measure`), broken past 360 px and at the title's newlines (at
  most 16 lines and 1024 characters, as Chromium's), under the pointer's arrow, above the pointer
  where there is no room below, kept 4 px inside the window. It is drawn at the scene's root after
  everything else and takes no pointer.
* **Labelled once**: the controls the page labels itself carry no `title` (only `aria-label`), so the
  engine says none for them; the app e2e checks it.
* `compositor_input_state.tooltip` says each page's title and the one showing with its box, for checks.

### Consequences

* Good, because every `title` of every page shows, in the theme, with the timing people know.
* Good, because the desk's page's CSS cursors reach the window: a pointer over its buttons, a text
  cursor in its fields, its dividers' resize cursors.
* Bad, because a page's cursor still comes a frame late: moving straight from one of its controls to
  another shows the first one's cursor for that frame.
* Bad, because a native surface (#59) cannot say a hover title: the surface protocol has no message
  for one. A `tooltip` message in `specs/surface` is the next step when a native plugin needs it.
* Bad, because the title shows where the pointer came to rest, not where the element is, and does not
  follow a move: a move hides it and the next rest shows it again.
* Neutral: a window's title bar carries the page's "Maximize or restore (double-click the title)"
  title, which now shows over a title bar the pointer rests on (not after a drag), as it did in the
  windowed desk of Stage 1.

## More Information

Issue #156, item 3 (from the QA pass #154). Code: `apps/desk/shell/src/web_host/{client,routes}.rs`,
`web_host.rs` (`SurfaceSink::tooltip`), `client.rs` (`ShellDisplay`), `compositor_window/{tooltip,
tooltip_draw,composed,compose,clock,input,steps,page}.rs`, `apps/desk/src/compositor.css`,
`crates/desk-compositor/src/theme/mod.rs` (`TooltipStyle`),
`crates/desk-compositor/src/text/{fonts,layout}.rs` (`Fonts::measure`). Tests:
`compositor_window/tooltip_tests.rs`, `crates/desk-compositor/tests/{text_measure,theme_snapshots}.rs`,
`e2e/specs/tooltips.spec.ts`, and `windows-reach.spec.ts` and `windows-selection.spec.ts` for the
cursor and the drop. No section of `docs/ko/desk-structure.md` changes.
