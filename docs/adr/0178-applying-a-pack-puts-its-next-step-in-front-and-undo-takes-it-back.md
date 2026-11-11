---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

Amends ADR 0108 (what Apply opens, and in which order; what Undo takes back).

# Applying a pack puts its next step in front, and Undo takes Apply back

## Context and Problem Statement

ADR 0108 has Apply on a pack's card install the pack when needed, turn it and its plugins on, switch
to its profile, run what it opens and open Settings, Connections on its first connector. For
`desk.pack-github` that opened the GitHub board, a universal view, which is an overlay drawn above
the desk's page, together with Settings, a dialog of that page: the token form was underneath the
board, the first Escape closed it unseen, and the person was back on the desk with no token form.
The card's Undo did nothing, and the pack's profile laid out a window with no view behind it and a
second Projects window, which a switch back would only have put in the drawer (#161, findings 5 and
17). What does the person see after Apply, and what does Undo give back?

## Decision Drivers

* After Apply the person is in front of the next step, whole, and Escape closes what they see
* Undo gives the desk back as it was: the profile, the plugins on, the windows
* No new command or protocol; the card stays the runtime's (ADR 0073)

## Considered Options

* The next step in front: the token form while the connector has no account, what the pack opens
  offered on the card for after; what it opens at once when the connector has one
* Open the board when Settings closes
* Keep opening both, the board under Settings

## Decision Outcome

Chosen option: "The next step in front", because a board of a service with no account is empty and
says so, while the token form is what the person came for; the card already stays on the desk's page
under the form, so it can offer the board once the form is closed, and Settings gives the focus back
to it. The runtime decides by `connector.list`: an account not in error counts. Opening the board when
Settings closes would need the settings window to tell the runtime, and a third way out of Settings
the person did not ask for; keeping both is the defect.

* Apply says what it applied before the form opens ("GitHub is on. Put your token in Settings,
  Connections, then open GitHub board here."), with one button per command the pack opens, the first
  in focus, before Undo and Close.
* Undo switches back to the profile in force before (first: the pack contributes its profile), turns
  off what Apply turned on (the pack last), turns back on what its profile turned off, and removes a
  pack Apply installed from a market; what was on before stays on.
* A pack's profile places no window that only its Apply would bring: a switch back puts every window
  a profile placed in the drawer (ADR 0117), which Undo cannot take back. Builder morning keeps its
  plugins, icon and morning trigger.
* "Set up a service…" with no service asks which through `desk.palette.pick` (the packs on the desk,
  or a service typed) and answers at once, as `desk.propose` does.

### Consequences

* Good, because the token form is the front layer after Apply, and Undo leaves `desk.windows.list` as
  it was before Apply (`e2e/specs/pack-github.spec.ts`).
* Good, because a pack whose connector is already connected behaves as before: what it opens, at once.
* Bad, because the board takes one more press after the token is in, and the card that offers it is
  drawn under window titles until the desk's chrome draws cards above windows (#158).
* Bad, because a pack's profile cannot lay a window out for what it brings; a person who wants one
  saves it into the profile.

## More Information

`packages/runtime/src/propose/pack.ts`, `packages/runtime/src/propose/pack-undo.ts`,
`packages/runtime/src/propose/card.ts`, `plugins/pack-github`. ADR 0073, ADR 0108, ADR 0117. Issue #161.
