---
status: accepted
date: 2026-11-18
decision-makers: Team endue
---

Amends ADR 0023 (the system layer: what no profile moves, hides or replaces) and ADR 0217 (how a
plugin is opened on a desk with no dock).

# A shortcut bar above the agent bar runs the person's plugins and commands

## Context and Problem Statement

The left column holds the profile switcher (top), the agent bar (centred 88 px above the middle) and
the account bar (bottom), whose launcher button is the one control on screen that opens a plugin
(ADR 0217). Search (`desk.palette.open`) has a key and no button. The person asked for a second bar
of the same shape above the agent bar, holding shortcuts they choose: a plugin, Search, any action
that a button press can start. Where does it stand, what goes on it, how is it changed and kept, and
what happens to the agent bar under it?

## Decision Drivers

* The bars' one shape (52 wide, 16 radius, buttons of 36: #291, #292) and the system layer's place
  in every desktop and mode
* A plugin and a command alike: anything the palette or a key can run
* Changed where it stands, with the pointer and the keyboard, and from the palette, a plugin or an
  agent
* Kept with the person, not with a desk's session or a profile
* The agent bar stays usable at the app's smallest size (1024×500) and never jumps when the shortcut
  bar changes

## Considered Options

* A shortcut bar in the system layer under the profile switcher, the agent bar kept clear of it
* Shortcuts as a group at the top of the agent bar itself
* Pinned plugins in the launcher, shown in the account bar

## Decision Outcome

Chosen option: "a shortcut bar in the system layer", because it is the bar the person asked for, it
keeps the agent bar's groups about agents and spaces, and it is the desk's own part like the account
bar, so no profile or role takes it away.

* **The bar** (`packages/runtime/src/system/ShortcutBar.ts`) hangs at 116 px, under the profile
  switcher, 16 from the left edge, no taller than half the room between 116 px and the account bar's
  200 px (more scroll, with no scrollbar drawn). Its buttons are the shortcuts, top to bottom, then a
  "+". One of the desk's actions shows its icon (Search a magnifier) and a built-in plugin the icon
  its windows show (ADR 0273); any other shortcut its name's first letter in a rounded square drawn
  as the line icons are.
* **A shortcut** is `{ plugin }` (a press runs `desk.plugins.open`) or `{ command }` (a press runs the
  command). One whose plugin is not installed or failed, or whose command nothing answers, stays on
  the bar, faint, and its tooltip says so.
* **The "+"** opens a list beside the bar: a field over the desk's actions (Search, All plugins,
  Settings, Inbox, Themes, those registered), every plugin that opens on the desk, and, once
  something is typed, every command. A press puts one on the bar or takes it off; the list stays open
  for the next. Typing matches a name's start, a word's start, an id's or a keyword's words, and
  from three letters anything inside a name. Enter takes the first row, the arrows walk the rows,
  Escape closes it back to the "+".
* **A shortcut's menu** (right-click, Shift+F10, the context menu key): Move up, Move down, Remove.
* **Kept** as the core setting `desk.shell.shortcuts` (an array, twelve at most, default Search
  alone), so it persists in the person's preferences, and init.yaml or a profile can set it.
  `desk.shortcuts.add` and `desk.shortcuts.remove` take `{ plugin }` or `{ command }`; with neither
  they open the "+".
* **The agent bar** stays centred 88 px above the middle while that keeps its top 12 under the
  shortcut bar; otherwise it hangs from there, down to the 200 px, and scrolls past that. The page
  says the shortcut bar's button count on the system layer (`--shortcuts-count`) and the stylesheet
  works the height out of the bar tokens, so the agent bar is placed in the first frame without
  measuring. The old rule for apps under 628 px high is folded into this one.
* **The compositor** draws it as a part of its own, `desk.shortcuts`, between the desktops and the
  agent bar (`desk_web::sender::PARTS`, `apps/desk/src/compositor-system.ts`). It slides out past
  the left edge with the agent bar while a window fills the app (ADR 0221).

### Consequences

* Good, because Search and the plugins the person uses most are one press away, with no key to know
* Good, because a plugin, the palette or an agent can put a shortcut on the bar through a command
* Good, because the agent bar no longer scrolls in a tall app when it fits under the shortcut bar
* Bad, because at 1440×900 and below the agent bar moves down (its top from 172 to 220 px with
  Search alone) and in the smallest app it has less room before it scrolls
* Bad, because the launcher can now be in two places, the account bar and the shortcut bar
* Bad, because shortcuts move only through their menu: there is no drag to reorder yet
* Bad, because a community plugin has no icon in its manifest, so its shortcut shows a letter

## More Information

Issue: none; the person asked in the session. `docs/ko/desk-structure.md`'s table of what a profile
cannot change ("프로필이 못 바꾸는 것") should name the shortcut bar beside the agent bar; that file is
source material, left to the maintainers. Tests: `src/system/shortcuts.test.ts`,
`src/system/ShortcutBar.test.ts`, `e2e/shortcuts.spec.ts`, the bars' shape in
`e2e/shell-bars.spec.ts`, the parts at small sizes in `e2e/shell-sizes.spec.ts`.
