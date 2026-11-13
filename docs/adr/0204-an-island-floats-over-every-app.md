---
status: accepted
date: 2026-11-13
decision-makers: Team endue
---

Amends ADR 0121 (the floating Eris becomes the island's) and ADR 0190 (a question also reaches the
person on the island, which takes the keys only when pressed). Follows ADR 0203.

# An island floats over every app, closed with what is going on and open where the person answers

## Context and Problem Statement

ADR 0203 leaves the screen to the OS: once apps are OS windows (#235) and home is an ordinary window
(#236), nothing of endue is on screen while the person works in another app. Yet that is when an
agent works, a permission prompt waits (the core waits for it with no timeout, ADR 0190) and Eris is
called (Option+Enter, ADR 0121). Today three things carry that: the floating Eris, the tray's menu and
the permissions overlay inside the desk's page, which is on screen only while the desk is. The person
asked for one small surface, placed anywhere on the desktop over every app, that shows what is going
on and opens to answer, talk and call up an app (#238). What is it, how does it stay over every app
without taking the keys from the one in front, and how does it know how many asks wait?

## Decision Drivers

* Over every app, a full-screen one included, on every Space, out of the OS's window cycling
* The app in front keeps the keys until the person presses the island (ADR 0121's rule, kept)
* The count of asks is exact: up when a prompt or an approval comes, down when any prompter answers
* The island holds no grant of its own: a holder that does not answer leaves its asker waiting for
  ever (ADR 0190's lesson)
* Reuse what works: `float.rs`, `pane.rs`, the floating Eris's place per display, the palette's small
  host page, the desk's theme in its other windows (ADR 0056)

## Considered Options

* A window of its own (role `Island`, `index.html?view=island`) made a non-activating panel on macOS,
  calling the core as the desk for what it shows; the core says what waits (`perm.pending`) and when
  it stops waiting (`perm.settled`)
* Grow the floating Eris's window into the island
* The OS's own surfaces: a menu bar extra with a popover, and system notifications
* The same island counting asks from `perm.prompt` and `perm.approval` alone, or the shell watching
  `perm.answer` calls

## Decision Outcome

Chosen option: "a window of its own made a non-activating panel", because it is the only one that is
over full-screen apps and answers without activating the desk, and the core already knows what waits.

* **The window** (`apps/desk/shell/src/island.rs`, `island/`). A floating window (`float.rs`) on every
  Space and full-screen Space, fixed in Mission Control, out of ⌘\` cycling, shown with
  `orderFrontRegardless`. On macOS it is an `NSPanel` made with `NSWindowStyleMaskNonactivatingPanel`:
  a press on it gives it the keys without making the desk the active app, and going away gives them
  back to the app in front. winit has no panel and a window's class cannot change once it exists
  (AppKit and winit observe every window, and key-value observing keeps the class it saw), so while
  winit makes the island's window, `WinitWindow`'s allocation hands out the shell's panel class (an
  `NSPanel` that may become key, never main, and keeps the style whatever winit sets) and `NSWindow`'s
  initializer gives it the style from the start; AppKit makes a panel given the style later
  non-activating but still lets a press activate the app. Both go back as they were once the window
  exists. winit treats the panel as its own window, which holds while neither adds memory to an
  `NSWindow` (checked before, else the island is a floating window). No third-party crate (ADR 0121
  left `NSPanel` as a follow-up for this reason).
* **Its place.** The person drags it anywhere (a press that moves, as the floating Eris's); its spot
  is kept per display (the middle of its top edge from the work area's corner, `eris_window/place.rs`)
  in `<data>/island.json`, so it comes back where it was after a restart and on the display it is
  shown on. With no spot kept it sits at the top in the middle of the work area.
* **Its page** (`apps/desk/src/island.ts`) is a small host like the palette's. Closed it is a pill:
  the agents at work (`agent.list`'s `working`, read again on `agent.changed`, and the agent
  programs `agents.ask` runs, from `agents.runs` and `agents.run`) and how many asks wait. Pressed it opens to list them
  and, as the slices land, to answer, talk and type to Eris, show notices and open an app. It follows
  the theme the main window keeps (ADR 0056).
* **Who it is.** Its bridge calls go to the core as the desk, as the floating Eris's do, and only the
  methods it needs pass (`desk_web::sender::Sender::may_ask`): `agent.list`, `agents.runs` and
  `perm.pending` for what it shows, `perm.answer`, `perm.approve` and `plugin.list` for answering,
  `brain.say` for talking. It
  hears every core event, as the desk's other windows do (`host.rs`). It holds no grant of its own,
  so the core never addresses a prompt to it.
* **What changes** (`specs/bridge/v0/agent.schema.json`). An agent's runs were items in the index
  alone, which the desk's caller does not read: `agent.changed` (the agent and the run) now goes to
  every perm:manage holder whenever a run is kept, waits, goes on or ends.
* **What waits** (`specs/bridge/v0/perm.schema.json`). `perm.pending` (perm:manage) answers every
  prompt and approval still waiting, as their events said them, for a prompter that comes up while
  they wait. `perm.settled` tells every perm:manage holder that one stopped waiting (answered by any
  holder, withdrawn with its caller, or decided by the Prompter), so the island's count goes down and
  each prompter takes down a card another one answered.
* **Behind a setting** until it can take the floating Eris's place: `desk.island.show` (declared by
  `plugins/island`), off by default, read when it changes. Hiding it changes nothing else.
* **ADR 0121.** The island is where Eris is called while it shows. Open, it talks and types to her in
  the desk's one conversation, as the floating Eris does (`brain.say` as the desk, her turns from
  `brain.turn`, the lines handed to the desk through the app's storage), without her figure.
  Option+Enter and the tray's Talk to Eris, while the desk is not in front, open it on her field and
  give it the keys (`makeKeyAndOrderFront` on the panel, which leaves the app in front active);
  pressed again, or Escape outside a composition, fold it and give the keys back (the panel leaves
  the screen and comes back at once, no longer key). The floating Eris stays down while the island
  shows. Then she and the tray's status retire, and `desk.island.show` turns on by default.
* **ADR 0190.** The permissions plugin stays the desk's prompter and its overlay stays hidden until a
  question comes. The island counts the same question on its pill, without the keys; the person's
  press opens it on the card in front, in the plugin's own words and with its choices, answered with
  `perm.answer` or `perm.approve`; `perm.settled` takes the other card down. A new question never
  opens the island by itself, and a card's choices take no press in the first half second after it
  shows or comes to the front: a panel that grows under the pointer over another app's window
  catches a press meant for that window, and a live check on 2026-11-14 saw two such presses grant
  "Always allow" twice, the second on the card that took the first one's place.

Rejected: the floating Eris's window is transparent around her figure and activates the desk when
pressed, and the island must show what she does not (agents, asks, notices); her place and drag code
move over instead. A menu bar extra is not where the person looks while working, cannot be placed,
and its popover activates the app; system notifications cannot hold an answer with a diff. Counting
events alone never sees an answer, and watching calls misses the Prompter and a withdrawn caller. For the panel itself: changing the class of the window winit made broke key-value observing (the
desk aborted when the window went); AppKit's private setters would do it without a panel; and a panel
of the shell's own outside winit would need a second kind of window in `pane.rs`, the quit and the
window events.

### Consequences

* Good, because one surface replaces three (the floating Eris, the tray's status, the overlay out of
  sight) and is the only part of endue on screen while the person works elsewhere
* Good, because a question reaches the person over a full-screen app without taking their keys
* Good, because `perm.settled` fixes a gap that two prompters would have had anyway: the card another
  one answered
* Bad, because handing winit a panel for its window is runtime surgery winit does not know of: an
  upgrade that adds memory to `WinitWindow` or stops calling `NSWindow`'s initializer breaks it (the
  sizes are checked before and a test checks them; the panel's class is checked after)
* Bad, because a non-activating panel that takes the keys leaves the other app active without them:
  its menu bar stays while typing goes to the island, as with Spotlight
* Bad, because macOS only: Windows and Linux keep winit's always-on-top window and their task switcher
* Bad, because a second place to answer a question means the overlay and the island must agree; they
  do through the core, not through each other

## More Information

The step: #238 of #232. Its slices, each a PR: the island and its closed state (this ADR, the spec
change, the window and the setting); permission prompts and agents' approvals answered on it; talking
and typing to Eris with Option+Enter and Escape; notices under `desk.notify`'s rules, do-not-disturb,
the workspace in use, and retiring the floating Eris and the tray's status. The workspace in use waits
for the last slice: the desk has no workspace yet (ADR 0203 puts workspaces after the skeleton), and
the nearest thing it has, the profile in force, is what turns do-not-disturb on. `docs/ko/desk-structure.md`
(the shell's windows) and `docs/architecture.md` change with the slice that retires the floating Eris.
