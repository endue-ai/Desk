---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

# Closing a window and quitting ask about unsaved changes, as closing the buffer does

## Context and Problem Statement

The QA pass of 2026-11-11 lost typed work three ways (#160 finding 2, #162 finding 2, #163
finding 1): a note's or a sheet's window closed by its × went at once, and so did the desk on a
quit, while `Mod+W` on the same buffer asked "note.md has unsaved changes · Save, then close ·
Close without saving · Keep it open" (`desk.buffers.confirm-unsaved`). Only `desk.buffers.close`
asked: the window's × closes the window in desk-wm and unmounts the plugins it showed (ADR 0040),
and their buffers go with the surface without a word; the shell's quit closes every browser
(`window.rs`) and nothing in the shell knows a buffer. Where does the question live, so that every
way a buffer can go with the person's gesture asks the same thing?

## Decision Drivers

* No silent loss of unsaved work by a gesture the person makes: the ×, the menu's, the tray's or
  the Dock's Quit, the quit at logout, an update's restart
* One question, the one `Mod+W` asks, in the same words and with the same setting
* A desk whose page is gone or hung still quits

## Considered Options

* Ask: the buffer list has guards (Emacs's `kill-buffer-query-functions` and
  `kill-emacs-query-functions`) that a window's close and the quit run first, and the shell asks
  the desk's page before it quits
* Keep the text instead (a "hot exit"): every opener hands its unsaved text to the session, and the
  next start offers it back
* A native dialog in the shell on quit
* Chromium's `beforeunload`: close the browsers without force, and each plugin page with unsaved
  text holds its own close

## Decision Outcome

Chosen option: "Ask", because it closes all three losses with the question the desk already has,
in the runtime that knows the buffers, and a shell that waits for an answer only as long as a page
is there to give it.

* **The guard** (`packages/runtime/src/buffers.ts`): `Buffers.mayGo(leaving, { plugins })` asks
  each guard about the buffers going, the buffers of the plugins a window shows when it closes, or
  every buffer when the desk quits; the first no keeps them all. desk.buffers' guard asks about
  each buffer with unsaved changes in turn, showing it first: `Mod+W`'s question when a window
  closes, "Save, then quit · Quit without saving · Don't quit" when the desk quits. `Mod+W` on a
  plugin's own surface asks about the plugin's buffers that go with it too.
* **The window** (`shell/windows.ts`): closing a window, and closing the last pane of one, asks
  first and keeps the window on a no; the × reports a save that failed.
* **The quit** (`apps/desk/shell/src/quit.rs`, `apps/desk/src/quit.ts`): a quit the person asks
  for tells the desk's page `desk://quit`; the page answers `desk_quit` with `quit` at once when
  nothing is unsaved, else `asking` (the shell brings the desk forward and waits for the person),
  then `quit` or `stay`. A page that gives no first answer in 3 s does not hold the quit. A quit
  asked again while the person decides asks the page again, so a page that died meanwhile cannot
  keep the desk from quitting. A page that closed its own window still ends the desk at once.

### Consequences

* Good, because the ×, the last pane's close and every Quit ask what `Mod+W` asks, and
  `desk.buffers.confirm-unsaved: false` turns them all off.
* Good, because the shell learns no buffer: one event and one command, which only the desk's page
  may answer (`desk-web`'s `MAIN_COMMANDS`).
* Bad, because a quit waits up to 3 s on a page that does not answer before it goes.
* Bad, because DevTools' `Browser.close` (the e2e's and the QA harness's quit) starts Chromium's
  own shutdown first, which ends the renderers it may end at once (pages without an unload,
  `pagehide` or `visibilitychange` handler): the question shows, but a plugin's text may already be
  gone, and "Save, then quit" waits on that page until its window's Stop.
* Bad, because a SIGTERM or a kill still ends the desk without a word; keeping the text across a
  quit (the second option) is still the way to cover them, once the openers keep their state
  (the surface-state helper of the A6 work order).
* Bad, because a quit with many changed buffers asks once for each.

## More Information

Issues #160, #162, #163 (QA pass 2026-11-11, work order A5). Amends ADR 0040 (closing a window
unmounts its plugins: now once the person answered). Code: `packages/runtime/src/buffers.ts`,
`packages/runtime/src/policies/buffers.ts`, `packages/runtime/src/shell/windows.ts`,
`packages/runtime/src/surface/{placed,Surface}.ts`, `apps/desk/src/quit.ts`,
`apps/desk/shell/src/{quit,window,commands}.rs`, `crates/desk-web/src/sender.rs`. Tests:
`packages/runtime/src/policies/buffers.test.ts`, `packages/runtime/src/shell/windows.test.ts`,
`apps/desk/src/quit.test.ts`, `apps/desk/shell/src/quit.rs`, `packages/runtime/e2e/shell-unsaved.spec.ts`,
`e2e/specs/unsaved.spec.ts`. No section of `docs/ko/desk-structure.md` changes.
