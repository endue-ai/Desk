---
status: proposed
date: 2026-11-15
decision-makers: Team endue
---

# The terminal keeps its panes in its own store

## Context and Problem Statement

Issue 315 splits a terminal tab into panes, each with its own shell, and asks that the split layout
and each pane's working folder come back after a restart. The terminal already comes back from a
reload: the runtime hands a plugin its last `desk:state` (TERM-S07), and the core's processes keep
running, so each tab attaches to its process again. That state lives only in the runtime's memory. It
is gone when the app quits, and so are the shells. The desk's session (`desk.session`, ADR 0017) keeps
the windows, buffers and files open. It has no slot for what one plugin holds inside its surface.
Where does the terminal keep its layout so that it survives a restart, and in what shape?

## Decision Drivers

- Only public contracts: the terminal is written as a community plugin would be (ADR 0037), so the
  layout goes through the bridge, not a runtime change.
- No new permission: the terminal asks for nothing it did not ask for before.
- A shape that a later version can read, or refuse, without harm.

## Considered Options

1. The plugin's own `store.set` key `layout` (desk-core storage, per caller, no permission).
2. A new slot in the runtime's session for a surface's state, kept by `desk.session`.
3. A file the plugin writes with `fs.write` under its data folder.

## Decision Outcome

Chosen option: 1. A change to the layout writes `store.set { key: "layout" }` when it settles, with
the reload snapshot, and only when the layout changed. A start with no reload snapshot reads it with
`store.get`. If it reads as a layout, the same tabs and splits open, each pane a fresh shell in its
folder. Otherwise one terminal opens, as before.

The value is versioned:

```json
{ "v": 1, "shown": 0, "tabs": [{ "focused": 1, "layout": {
  "split": "right", "ratio": 0.5,
  "a": { "pane": { "cwd": "/src", "title": "zsh", "named": false } },
  "b": { "pane": { "cwd": "/var/log", "title": "logs", "named": true } } } }] }
```

A node is either `{ pane: { cwd, title, named } }` or `{ split: "right" | "down", ratio, a, b }`.
`right` puts `b` beside `a`, `down` below it. `focused` and `shown` are positions, not session ids,
because the ids name processes that do not outlive the app. Closing every terminal writes `null`, so
the next start opens one terminal. Anything else (another `v`, a ratio outside (0, 1), a focus past the
panes) reads as nothing.

### Consequences

- Good: no runtime, spec or permission change. Another plugin can copy the pattern.
- Good: a reload still attaches to the running shells. The snapshot gains `tabs` (each tab's layout
  by session id), and a snapshot without it reads as one tab per session.
- Bad: the layout comes back whether or not `desk.session.restore` is on. The terminal does not
  read another plugin's settings, and it has no hook into the desk's "forget".
- Bad: scrollback and running programs do not come back (TERM-S08), and a pane that ran an
  `endue.terminal.run` program comes back as a shell in its folder.

## More Information

`plugins/terminal/ui/keep.js` writes and reads the value; `layout.js` holds the tree;
`restore.js` makes the tabs again. Tests: `plugins/terminal/tests/layout.test.ts` and `panes.test.ts`.
