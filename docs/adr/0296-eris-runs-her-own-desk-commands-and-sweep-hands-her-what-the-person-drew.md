---
status: accepted
date: 2026-11-21
decision-makers: Team endue
---

# Eris runs her own desk commands without a question, her model is a setting, and a sweep hands her what the person drew

## Context and Problem Statement

Four requests met in one place, Eris and the desk around her:

* Asking Eris to "open a new tab" put up a permission card ("Agent eris asks for permission · Run
  commands desk.windows.new-tab"). ADR 0268 lets an agent run an installed plugin's commands without
  a question, but kept the desk's own (`desk`) commands asking, so every window command Eris runs
  on the person's own desk asked once a session.
* Her model could not be changed: `brain.use` picks endue, Claude Code, local or echo, and
  `brain.model` the local brain's Ollama model, but Claude Code's model came only from the
  environment (`DESK_CLAUDE_MODEL`), and nothing let the person, or Eris when asked, switch.
* Copy and paste are keys, not commands: ⌘C goes to the page as typed (ADR 0194), so another key a
  person binds (Emacs's M-w, Ctrl+Insert) can do nothing, and a field in a frame inside a page got
  no edit commands on the Mac at all.
* There was no way to point at part of the desk: select several windows, lay a group out in an
  area, or ask Eris about what is on screen there.

## Decision Drivers

* Eris acts on the person's desk as the person would; another agent still asks
* An allowlist in init.yaml still caps every agent, Eris included; an irreversible command is still
  held for a yes (ADR 0078)
* A choice the core already reads every turn stays the one source: settings, not a new store
* Keys stay the keymap's; ⌘C keeps working exactly as before
* Brains read text (specs/brain): no spec change for pictures in this step

## Decision Outcome

* **Eris's desk commands.** `check_agent` lets `agent:eris` run, without asking, a command the desk
  itself provides whose id is `desk.windows.*`, `desk.eris.*` or `desk.sweep.*`
  (`ERIS_DESK_COMMANDS` in `agents.rs`). It is checked after the allowlist and before grants, as an
  installed plugin's command is; nothing is granted, so the person's grants list is unchanged. Any
  other agent, and any other desk command, asks as before.
* **Her model.** `brain.claude-model` names Claude Code's model (empty: its own); the core makes one
  Claude Code brain per model (`Brains::with_claude_models`, sessions in `brain-claude-<model>.json`)
  and keeps the env's as the default. `desk.eris.model { brain, model }` sets the model first and
  then `brain.use`, so the next turn uses it; `desk.eris.models` says what is in force. Both are
  Eris's tools, so "switch to Sonnet" works by asking her, and the rail's brain popover shows the
  model under the brain (Default/Opus/Sonnet/Haiku, or the Ollama model's name).
* **Edit commands.** `desk.edit.copy`, `.cut`, `.paste`, `.paste-and-match-style`, `.select-all`,
  `.undo` and `.redo` have no keys of their own; bound to any key, they ask the shell
  (`compositor_edit_command`) to run the Edit menu's command in the focused frame of the window
  with the keys (CEF's `Frame::copy` and the rest). On the Mac an Edit menu key whose focus is in a
  frame inside the page now goes there too, after the page heard the key.
* **Sweep.** Cmd+drag (Ctrl+drag elsewhere) on the empty desk draws an area; its mode decides:
  Pan moves the canvas, Arrange lays out the windows it touches in a grid inside it, Ask snaps it
  and hands it to Eris with the next line, Select picks the windows it touches (Shift adds). 1–4 pick
  the mode while sweeping, the bar shows them, and `desk.sweep.mode` sets it. The selection bar runs
  Arrange, Snapshot, Ask Eris, Put away and Close on what is picked; Eris reads it with
  `desk.sweep.selection`. A snapshot is the area put together from each window's last frame
  (`ui.surface.snapshot`), saved under `~/.desk/snapshots` (the runtime may write there now), and
  said in words: the area, each window's title, plugin and place, and where the picture is. The area
  and the rings are a compositor part that hears nothing (`desk.sweep-marks`), the bar one that does
  (`desk.sweep`).

### Consequences

* Good: Eris opens tabs, moves windows and changes her own model without a card; the person still
  sees every errand on screen (ADR 0275).
* Good: any key can copy and paste, and fields in frames get the Mac's edit keys.
* Good: several windows can be picked and acted on, and a part of the desk can be put to Eris.
* Bad: Eris reads a snapshot as words, not pixels: she knows what windows are there and where, not
  what they show. Pictures in a turn need image parts in `specs/brain` and every brain; that is a
  maintainer's spec change, left for later.
* Bad: a person who wants Eris to ask before every window command has no switch yet; an init.yaml
  allowlist for `eris` that leaves `desk.windows.*` out keeps them from her meanwhile.
