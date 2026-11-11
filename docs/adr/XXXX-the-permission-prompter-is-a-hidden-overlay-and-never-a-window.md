---
status: accepted
date: 2026-11-12
decision-makers: Team endue
---

# The permission prompter is a hidden overlay and never a window; a refusal is taken back in its list

## Context and Problem Statement

`endue.permissions` is the desk's prompter: the core addresses every `perm.prompt` and agent
`perm.approval` (ADR 0078) to the `perm:manage` holders and waits, with no timeout, for the first
answer (ADR 0029). Its manifest declared a `main` surface placed `right` and a `prompt` overlay, but
a plugin has one page (ADR 0160), placed by its first surface: the prompter was a window like any
other. The 2026-11-11 QA pass (#161 findings 1, 2, 11; #162 findings 5, 6, 16; #158 finding 13) found
what followed. A person who closed that window unmounted the plugin for the session, while the core
still counted it as a holder: every later question went nowhere and its asker waited for ever (a
save, a folder read, Eris's turn, Agents). A question that came was drawn inside the window in its
default slot, whose lower third lies under the dock and the bottom edge of a 1280x800 desk: "Don't
allow" and the approval card's buttons could not be reached. Raising the window did not give it the
keys, so Escape refused nothing. And a refusal, which the core remembers for the session (CORE-03),
could not be taken back: one mis-click cost the session's saves. Where does the question live so
that it always reaches the person, and how does the person change their mind?

## Decision Drivers

* A question is shown whatever the person did to the desk's windows, and its asker never waits on a
  page that is gone
* In front of every window, bar and overlay, whole at every size from 1024x500 up, with the keys
* The core's contract unchanged: no timeout, no new method, the prompt policy as it is
* The plugin stays a community-format plugin on the public bridge API (ADR 0012)

## Considered Options

* The plugin's one surface a hidden overlay (`placement: overlay`, `hidden: true`), as the palette
  and the universal views are; the list a sheet in it, opened by the person
* Keep the window: the runtime relaunches an unmounted prompter for a prompt, and the window is moved
  into view and given the keys when a question comes
* A second plugin for the prompter (an overlay) beside the list (a window)
* A timeout in the core: a question nobody answers is refused after a while

## Decision Outcome

Chosen option: "a hidden overlay", because an overlay is never a window, so no close, drawer, desktop
switch or unload (ADR 0070 unloads windows only) ends the prompter or hides a question, and the
system layer already draws overlays above every window and bar (ADR 0160) and gives a shown overlay
the keys. Keeping the window would need runtime and window-manager changes for the plugin alone and
would still put a question wherever its window stands; a second plugin splits one permission view in
two and adds a built-in for every desk; a timeout turns "waits for ever" into a refusal the person
never saw.

* **The manifest.** One surface: `{ id: main, title: Permissions, placement: overlay, hidden: true }`.
  `ui:surface` is gone: the page shows and hides itself (`ctx.surface.show()`, `hide()`), as the
  palette does; there is no Permissions window in any layout.
* **A card** (a prompt, an approval, what an allowed write did) shows the overlay, every time one
  comes, which raises it above other overlays and gives it the keys. The card is centred on a scrim,
  at most the viewport less 16 px on each side; its body scrolls and its buttons stay in view. Focus
  starts on the least destructive answer; Tab stays in the card; Escape refuses, denies or closes; a
  press beside a card does nothing. With no card left the overlay hides.
* **The list.** Shown by the desk with no card for it (the palette's row, `desk.plugins.open`,
  Eris), the page hears that it became visible or focused and shows the list as a sheet: the grants
  to revoke, the agents apart, and this session's refusals. Close, Escape or a press beside it hides
  it; a card that comes while it is open goes in front of it and leaves it open.
* **Refusals.** The plugin keeps the refusals it answered (the core's memory has no API) and lists
  them under "Refused this session". Allow grants what was asked, for as long as it was asked
  (`perm.grant`, ADR 0131's method), which also ends the core's refusal; one a grant of the same
  permission ended leaves the list.
* **A page that loads again** (a renderer that died, a reload) gets back, through `desk:state`, the
  refusals and the cards still waiting, and shows them: the core waits on those prompts and would
  otherwise wait for ever. A card the core already decided answers `not_found` and moves on.

### Consequences

* Good, because a question reaches the person whatever they did to the desk's windows, at every
  size, with the keys, and the asker gets an answer.
* Good, because a mis-click is undone in the list without a restart.
* Bad, because the grant list is no longer a window to keep beside others; it is a sheet over the desk.
* Bad, because the keys go to the desk's page, not back to the window that had them, when the overlay
  hides: the runtime gives no overlay's focus back yet (the palette closing has the same gap,
  #158, #159).
* Bad, because a saved session or a person's layout that named the Permissions window finds none.
* Bad, because the page learns that the person opened it only from its visibility and focus: a
  browser that hears neither shows the scrim alone, which a press or Escape closes.

## More Information

Issues #161, #162, #158. Amends ADR 0160 (the permission prompt among the system layer's overlays is
now the plugin's only surface). Code: `plugins/permissions/plugin.json`, `plugins/permissions/ui/{overlay,
refusals,controller,view,main}.js`, `ui/index.html`, `ui/style.css`. Tests: `plugins/permissions/tests/
{overlay,refusals,prompt,approvals}.test.ts`, `e2e/specs/permission-prompt.spec.ts`. No section of
`docs/ko/desk-structure.md` changes; its line for `permissions/` ("프롬프트 창") reads as the overlay.
