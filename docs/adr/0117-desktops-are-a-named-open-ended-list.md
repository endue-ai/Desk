---
status: proposed
date: 2026-11-07
decision-makers: Team endue
---

# Desktops are a named, open-ended list

## Context and Problem Statement

Every profile had exactly four desktops (window views): `DesktopIndex = 1 | 2 | 3 | 4`. A profile's
recipe (`desk.shell.mode`) and the moved desktops (`desk.shell.layouts`, kept in the session and saved
into profiles) were objects keyed by desktop number; the shell's session part kept the pan by number
and the desktop in front as a number. The switcher was four 2×2 maps and "+", which only jumped to an
empty desktop; nothing moved a window from one desktop to another (RT-02). The person asked for as
many window views as they like. How do desktops get names and a variable count, what is persisted,
and how does what four-desktop desks saved keep loading?

## Decision Drivers

* A desktop keeps its windows, pan and window in use when it is renamed or moved in the list
* Data saved by the four-desktop desk loads unchanged, with no migration step to run
* A fresh desk opens as before: four desktops named 1 to 4, the same switcher, the same keys
* Code that imports `DesktopIndex`, `layoutOf` and `windowsOf` keeps compiling
* Eris can propose a profile with more than four named desktops, checked like any other proposal

## Considered Options

* A list of desktops, each with a stable string id and a name; its position is its index
* Keep layouts keyed by position and renumber them on every reorder and removal
* Keep four desktops and add named "groups" of windows over them

## Decision Outcome

Chosen option: "a list with stable ids", because a position cannot be a key once desktops reorder,
and ids that are the old numbers make the old data the new data's first four entries.

* **Ids, names, order.** A desktop is `{ id, name }`; a profile's desktops are a list (`Mode.list`).
  The four a desk starts with have ids "1" to "4" and are named "1" to "4". A new desktop's id is one
  more than any number a list, layout, pan or kept focus still uses, so it never inherits a removed
  desktop's windows; its name is the first free number. At most 32 desktops, names at most 40
  characters, the last desktop cannot be removed.
* **What a number means.** `DesktopIndex` is now `number`, a position from 1. `layoutOf`, `windowsOf`,
  `savedLayout`, `effectiveLayout` and `setDesktop` take an id or a position (`DesktopRef`). The
  store's `desktop` is an id; a number written there by older code is read as a position.
* **Persisted format.** `desk.shell.mode.desktops` and `desk.shell.layouts` hold a list:
  `{ "desktops": [{ "id": "1", "name": "Mail", "layout": { "surfaces": [...] } }, ...] }` (the
  recipe's entries are the list itself; `layout` is partial over the recipe's `desktop` in a recipe,
  whole in the session, and absent for a desktop nothing moved). The shell's session part keeps that
  value as `layouts`, the pan by id, and the desktop in front by its position, a number as before
  (the list it indexes is restored first). Saving any profile writes the list.
* **Migration.** None to run: a recipe or `desk.shell.layouts` that is an object keyed by number is
  read as layouts by id over the four default desktops, a session's pan keyed by number is the same
  ids, and a saved numeric `desktop` is a position (`desktops/migrate.ts`, `migrate.test.ts`). The
  sample profiles in `plugins/shell/plugin.json` stay in the old form and load through it.
* **Unsaved, like a moved window.** Adding, renaming, removing and reordering change the session's
  list; the profile shows its "changed" dot until it is saved into (or as) a profile or reverted.
  Switching profiles drops the session's list with its layouts.
* **Windows across desktops.** Moving a window keeps its size, panes and place on screen (adjusted
  for the two desktops' pans) and makes it the window in use there; it can be undone
  (`desk.shell.desktop-undo`). A plugin window in its slot is on every desktop until it is moved,
  resized or sent somewhere; once a desktop places it, it lives there only, and showing its plugin
  goes to that desktop. Removing a desktop moves its windows to the desktop before it (after it, for
  the first) or closes them, after asking when there are any.
* **Keys.** `desk.shell.desktop-1` to `-9` and `move-to-desktop-1` to `-9` exist for the list's
  first nine desktops, bound to `Mod+1…9` and `Mod+Shift+1…9` in `plugins/shell/plugin.json`; the
  core's `Control+1…4` stay. `Mod+Shift+]` and `Mod+Shift+[` go to the next and previous desktop,
  `Mod+Shift+\` opens the overview. A key whose desktop is not there passes on.
* **Eris.** `propose/profile-model.ts` accepts the list (unique short ids, names, layouts checked as
  before) and still the four by number; her guide describes the list.

### Consequences

* Good, because desktops can be named, added up to 32, reordered and removed without touching any
  window's coordinates or the data of other desktops.
* Good, because every profile and session saved before loads, and the default desk is unchanged.
* Bad, because two forms of `desk.shell.mode.desktops` are read for as long as old profiles exist;
  only the list is written.
* Bad, because a plugin window that a desktop places no longer shows on the other desktops in its
  slot, as it did before; it shows where it lives.
* Neutral: on macOS ⌘⇧3, ⌘⇧4 and ⌘⇧5 are the system's screenshot keys, so those three moves are
  reached through the window menu, the palette or a drag; physical Shift+digit matching in the key
  router arrives with the key-sequence work (#543).

### Confirmation

`desktops/model.test.ts` (create, rename, remove moving the windows, reorder, the cap, each desktop's
own layout and pan), `desktops/migrate.test.ts` (four-desktop profiles and sessions),
`desktops/move.test.ts` (geometry, focus, undo, plugin windows), `shell/commands.test.ts` (commands
and keys), `propose/profile-model.test.ts`, and `e2e/desktops.spec.ts` with snapshots of six named
desktops, the overview and a moved window; the full-shell snapshots stay as they were.

## More Information

Out of scope, as follow-ups: a wallpaper per desktop and what Eris sees per desktop.
