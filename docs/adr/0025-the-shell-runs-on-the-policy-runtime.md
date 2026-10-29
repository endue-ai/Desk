---
status: accepted
date: 2026-10-30
decision-makers: Team endue
---

# The shell runs on the policy runtime

## Context and Problem Statement

The shell (#21) and the desk's policy plugins (#55, ADR 0017) were built side by side and solved the
same things twice: a command list, a keymap with saved overrides, modes beside profiles, a token CSS
file beside desk.theme, the shell's own storage beside desk.session. `mountDesk` never created the
runtime, so there were two desks. What should the shell be, now that the policies exist?

## Decision Drivers

* One command registry, one keymap, one settings stack, one theme, one session record
* Keep what only the shell has: the system layer, desktops 1–4, Eris, the rail, the bottom edge, panes
* Plugins and init.yaml reach the shell the way they reach the bare desk

## Considered Options

* The shell hosts the runtime and uses its policies; its own copies go
* The shell's views become runtime surfaces on the compositor's grid
* Keep both and bridge them

## Decision Outcome

Chosen option: "the shell hosts the runtime". `mountDesk` creates the runtime under the mode layer
(plugin surfaces, the status line) and uses it for everything the policies decide:

* **Commands and keys.** The shell defines its commands in the registry (`desk.display.new-surface`,
  `split-right`, `split-down`, `close-pane`; `desk.shell.desktop-1`…`4`, views, profiles, agents, Eris).
  Their keys are in desk.keys. The rebinding screen writes the person's layer (`desk.keys.bindings`),
  which desk.session keeps. Clashes: `Mod+K` stays the palette (the talk line opens by typing),
  Escape is `desk.keys.quit`, `Mod+W` stays `desk.buffers.close`, `Mod+Shift+D` stays do not disturb,
  and split down is `Mod+Alt+D` (Alt combos name the physical key, so macOS's Option does not break it).
* **Panes are host views.** desk.display's focus cycling (`Mod+]`, `Mod+[`, `Control+Tab`) and
  desk.buffers (`Mod+W` closes the pane in use) reach them as they reach plugin surfaces.
* **Modes are profiles.** A profile's `desk.shell.mode` setting lays out desktops 1–4 over the
  setting's default (the old base); `desk.shell.layouts` holds the desktops moved since it was saved.
  Saving, saving as new and switching are desk.profiles commands.
* **Colours are theme tokens.** The shell's colours are `desk.shell.dark` and `desk.shell.light` over
  desk.theme's, read as `--desk-*`; the contrast test checks the theme data.
* **State is the session's.** The shell's desktop, drawer, space and unsaved desktops are a desk.session
  part.

The shell's floating windows stay the shell's (their own geometry and panes); plugin surfaces stay on
the compositor's grid. The sample profiles turn `endue.dock`, `endue.toolbar` and `endue.sidebar` off,
since the rail, the bottom edge and the agent bar hold those places.

### Consequences

* Good, because a plugin's command, key, theme or profile reaches the shell with no shell code.
* Good, because the shell's state survives restarts through the same record as the desk's.
* Bad, because two window models remain: the shell's floating windows and the grid. One of them should
  go when the shell's views become plugins.
* Bad, because profiles that lay the desk out (`desk.shell.mode`) mean nothing on the bare desk.

## More Information

`plugins/shell/` (desk.shell); `packages/runtime/src/shell/{Desk,commands,link,panes}.ts`,
`src/views.ts`, `src/rebind.ts`. `docs/ko/desk-structure.md` should describe profiles as the shell's
modes. Supersedes nothing; amends ADR 0023 (profiles, not modes).
