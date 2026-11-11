---
status: proposed
date: 2026-11-12
decision-makers: Team endue
---

# A profile's windows open in front and leave with it

## Context and Problem Statement

A profile lays windows out on its desktops (`desk.shell.mode`); the plugins nobody places have a window
each in a slot (ADR 0040), on every desktop until a desktop places them (ADR 0117). Two things went
wrong with the sample profiles (#158). A switch put the next profile's windows at the bottom of the
stack, under the ten plugin windows that stay in their slots: switching looked like nothing happened.
And leaving a profile put its windows in the drawer; a drawer item showing a plugin hides that plugin's
slot window, so after a tour of the samples Default came back with Calendar, Eris, Notes and Projects
gone and five copies in the drawer. Where do a profile's windows stack, and where do they go when the
person leaves the profile?

## Decision Drivers

* A tour of the profiles ends on the desk it started from
* What a switch shows is the next profile's layout, not the windows that were there
* Nothing the person opened in the session is lost by a switch
* No change to what profiles and sessions save

## Considered Options

* The slot windows lie under what a layout places; leaving a profile, its own windows and the plugins'
  own windows come back by themselves, so they skip the drawer
* Keep the drawer as it was and let a drawer item hide a slot window only when it is that window
* Only feed the switch's windows to the order of use (ADR 0168), keeping the slots after the layout

## Decision Outcome

Chosen option: the first, because it fixes both findings in the window manager's switch and order alone,
with nothing new kept. The order of use alone would leave a profile's windows under the slot windows
until each is used, and under any slot window used before the switch on desktops not in front.

* **Order.** A desktop's desk order is the plugin windows in their slots, then what its layout places
  (`Desk::windows_of`). Windows never in use stack in desk order under the others (ADR 0168), so what a
  profile, a move or an open placed lies over the slots. Tile lays windows out in that order.
* **Switching in.** The next profile's windows count as used (ADR 0168's order of use), in the profile's
  order: those of the other desktops first, then those of the desktop in front, each taking the focus in
  turn; the last one stays in use (`Desk::switch_profile`). On every desktop they are in front.
* **Leaving.** The windows the profile left saved leave with it, from its desktops and from the drawer:
  it lays them out again when it is back. A plugin's own window (named after its plugin, showing nothing
  else) moved in the session goes back to its slot. Only what else the session placed, and the next
  profile places nowhere, goes to the drawer, as before. `modes/model.ts`'s `leftBehind` says the same.

### Consequences

* Good, because the tour ends with the same windows, rects and desktops as it started, and the drawer
  stays empty through it.
* Good, because a moved or new window no longer sinks under every plugin window in its slot.
* Bad, because a profile's window put away in the drawer comes back when the profile does, as its other
  session edits do not survive a switch either.
* Bad, because the window in use when the person leaves a profile that had it is gone, so no window is
  in use until one is clicked.
* Neutral: it builds on the order of use (ADR 0168): a switch is one more way a window is put in use.

### Confirmation

`crates/desk-wm/tests/profile_switch.rs` (the tour, slots given back, put-away windows, a moved plugin
window, the session's window in the drawer, the next profile in front), `tests/drawer.rs`,
`tests/arrange.rs`, `tests/cover.rs`, `modes/model.test.ts`, and the app e2e `windows-profiles` on the
desk as it starts.
