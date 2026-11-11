---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

# Off-screen pages get the Mac's editing keys and a text field's menu from the shell

## Context and Problem Statement

Since the compositor became the only desk (#83) every page, the desk's own and each plugin's, is an
off-screen CEF browser. The QA pass (#154, issue #156 items 1 and 4) found two things Chromium
leaves to the view that holds a windowed browser gone from every text field at once:

* On macOS, ⌘A, ⌘C, ⌘X, ⌘V, ⌘Z and ⇧⌘Z come from the Edit menu's key equivalents and ⌘←, ⌘→,
  ⌘↑, ⌘↓, ⌘⌫, ⌃A, ⌃E and the rest from AppKit's key bindings (`interpretKeyEvents:`); a windowed
  view hands them to Blink as edit commands with the key down. CEF's `SendKeyEvent` carries no
  commands, and Blink binds none of these keys itself on macOS, so they did nothing.
* A right click in a field opened nothing: CEF asks the embedder of an off-screen browser to show
  its context menu (`RunContextMenu`) and drops it otherwise ("Default context menu implementation
  is not available"). With the first item, that left no way to copy or paste text at all.

How does the shell give every page these keys and a field's menu, keeping a page that binds a key
or draws its own menu in charge of it, and keeping the clipboard out of a page's reach?

## Decision Drivers

* Every text field of every page, the desk's own included, with no change to the plugins
* A page that cancels a key, or the `contextmenu` event, keeps it (Terminal, Explorer, Sheets)
* A page cannot choose a menu item for the person: Paste reads the system clipboard
* Testable through the compositor's input (`compositor_input`) with the screen locked
* The menu looks like the desk's other menus and works by pointer and by keys

## Considered Options

* Keys: each key down on macOS that AppKit would turn into commands goes to the page with those
  commands, through the browser's own DevTools agent (`Input.dispatchKeyEvent` with `commands`)
* Keys: call the frame's `Undo`, `Copy`, `Paste`, `SelectAll` after the key; move the caret by
  sending Home, End or Shift+Home instead
* Keys: run `Selection.modify` and `execCommand` in the page
* Menu: the shell places the menu in the page that asked, the page draws it there, and the shell
  judges every press on it by its own geometry
* Menu: a native `NSMenu` (muda's context menu) at the pointer
* Menu: drawn by the compositor, or by the runtime's page as a desk menu

## Decision Outcome

Chosen options: "the page's own DevTools agent with the key's commands" and "the shell places the
menu, the page draws it, the shell judges the presses".

* **Keys** (`web_host/edit_keys.rs`). On macOS a key down whose chord is one of the Edit menu's
  key equivalents or one of AppKit's standard key bindings Blink lacks goes to the page as
  `Input.dispatchKeyEvent` (`rawKeyDown`) with Blink's commands for it (`SelectAll`,
  `MoveToLeftEndOfLine`, `DeleteToBeginningOfLine`, `MoveToBeginningOfParagraph`, ...), on the
  same input queue `SendKeyEvent` feeds, in the order sent; every other key, and every key when
  the focus is in a frame inside the page, goes as before. Blink runs the commands as the key's
  default action, exactly as for a windowed view: a page that cancels the key keeps it. Windows and
  Linux are unchanged: Blink binds Ctrl+A, Ctrl+C and the rest itself there.
* **The menu bar.** The Edit menu's items stay AppKit's. The windowed views (the palette, Eris,
  the banner) answer them; in the desk's window nothing does, so they stay off and their key
  equivalents reach the window and go the keys' way above.
* **The field menu** (`web_host/field_menu*.rs`, `field_menu.js`). Every off-screen browser's
  client gets a context menu handler. CEF asks it only when the page did not cancel the
  `contextmenu` event. For an editable field it shows Undo, Redo, Cut, Copy, Paste and Select All
  as the field's edit state allows, for selected text Copy, and otherwise nothing (and no log line).
  The shell lays the menu out in the page's view (below and right of the pointer, flipped where the
  view has no room) and the page draws it there in its top layer, in the desk's menu tokens, in a
  closed shadow root. While it shows, every press, wheel and key that would reach that page is the
  menu's: a click on an item, a held right press let go on one, or Enter on the highlighted one
  continues CEF's menu with its command, which CEF runs on the frame that asked; Escape, a press
  elsewhere or the page losing the keys puts it away.

### Consequences

* Good, because every field of every page now selects all, moves by line and document, deletes to
  the line's start, undoes, redoes, cuts, copies and pastes by the Mac's keys and by a right click,
  through the compositor's own input path the app e2e drives (`e2e/specs/editing.spec.ts`).
* Good, because a page keeps the keys and menus it binds itself, and Blink runs the same commands a
  windowed Chromium runs, so a key does what it does in Chrome on the Mac.
* Good, because a page cannot pick a menu item: it only draws the menu; the shell decides what a
  press hit from the geometry it gave the page.
* Bad, because every browser that hears one of these keys has a DevTools session attached by the
  shell from then on (the accessibility export already attaches one where it runs).
* Bad, because the menu lives in the page: it is clipped to the page's window, desk chrome drawn
  over that window covers it, and a page could hide or restyle it (it cannot choose with it). A
  page's `MutationObserver` on `<html>` sees it come and go.
* Bad, because the Edit menu's items cannot be clicked in the desk's window; giving winit's view
  their actions would let the menu take ⌘C and the rest from the pages before they hear them.
  Whether to give it them, disabled while a key equivalent is being matched, is for a person to
  judge on an unlocked Mac.

## More Information

Issue #156 items 1 and 4 of the QA pass (#154). Code: `apps/desk/shell/src/web_host/edit_keys.rs`,
`input.rs`, `field_menu.rs`, `field_menu_model.rs`, `field_menu_client.rs`, `field_menu.js`,
`apps/desk/shell/src/menu.rs`. Tests: the unit tests beside each module and
`e2e/specs/editing.spec.ts` on `e2e/fixtures/plugin-e2e-input`.
