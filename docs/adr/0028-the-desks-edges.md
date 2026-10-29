---
status: proposed
date: 2026-10-30
decision-makers: Team endue
---

# The desk's edges: the edge plugins or the shell's bars

## Context and Problem Statement

Six things hold three places at `99ee07d`:

| Place | Plugin (#12, #35) | The shell (#70) |
| --- | --- | --- |
| Bottom | `plugins/dock` (`endue.dock`, placement `bottom`): a tile per plugin that opens on the desk, turned on and off with `plugin.setEnabled` | the bottom edge (`packages/runtime/src/shell/Bottom.ts`): the drawer, the talk line, running work, the drop zone |
| Right | `plugins/toolbar` (`endue.toolbar`, Status, placement `right`): the Plugins and Access drawers | the rail (`packages/runtime/src/shell/Rail.ts`): brain, what Eris sees, tasks, attention, other desks, the VM, listening |
| Left | `plugins/sidebar` (`endue.sidebar`, Plugins, placement `left`): the installed plugins, on and off | the agent bar (`packages/runtime/src/shell/SideBar.ts`, system layer, ADR 0023): agents and spaces from the directory (ADR 0024) |

The five sample profiles of `plugins/shell` turn the three plugins off (`plugins.disabled` in
`plugins/shell/plugin.json`, ADR 0025), since the shell's bars hold those places. The bare desk (what
`apps/desk/src/main.ts` mounts) shows the plugins. Each plugin's README lists the shell's part as its
"Later": running work and saved layouts (dock), the brain, tasks, attention, other desks, the VM and
listening (toolbar), agents and spaces (sidebar). Which of each pair stays?

```bash
cat packages/runtime/src/shell/Rail.ts | wc -l                                                        # 277
cat packages/runtime/src/shell/{Bottom,Composer,Drawer,Running}.ts packages/runtime/src/shell/bottom.css | wc -l   # 639
cat packages/runtime/src/shell/SideBar.ts packages/runtime/src/system/agents.ts | wc -l              # 283
for p in dock toolbar sidebar; do find plugins/$p/ui -maxdepth 1 \( -name '*.js' -o -name '*.css' -o -name '*.html' \) -exec cat {} + | wc -l; done   # 229 307 98
```

## Decision Drivers

* ADR 0026 governs: the recommendation here follows where it puts the shell's parts
* One implementation per place, and a profile turns a place's plugin on or off like any other
* The agent bar stays in the system layer, where no profile can hide it (ADR 0023)
* The plugins' current content (plugin tiles, the Plugins and Access drawers, the plugin list) keeps a home

## Considered Options

* `plugins/{dock,toolbar,sidebar}` stay and take the shell's parts in
* The shell's rail, bottom edge and agent bar stay; the plugins go
* Both stay, as now: the plugins on the bare desk, the shell's bars under the sample profiles

**The plugins stay.** Edge placement exists (`bottom`, `right`, `left` in
`specs/plugin/v0/plugin.schema.json`; sizes from display rules, `specs/plugin/v0/contributes.schema.json`).
Each move needs from the plugin API:

| Part | Needs | Status at the base commit |
| --- | --- | --- |
| Rail → toolbar | the brain's status and A2A tasks as bridge methods; every caller's grants (`perm.list`, `unsupported`); listening (`audio.capture.*`, `unsupported`); other desks and the VM; popovers wider than the bar | #74 (status, tasks), #73 (`perm.list`); the rest not specified |
| Bottom edge → dock | list, put away and bring back other callers' surfaces (`ui.surface.*` covers only the caller's own, and is `unsupported`); a printable key typed on the empty desk reaching the talk line; files dropped on the desk; A2A tasks; `cmd.*` and `brain.say` are served | #77 (own surfaces), #74 (tasks); the rest not specified |
| Agent bar → sidebar | the agent directory and spaces as bridge methods; opening an agent's screen as a surface; a role slot or system flag so no profile turns it off and it sits above the mode layer (`provides`, BR-05) | #74 (directory), #77 (`ui.surface`); role slots not specified |

**The shell's bars stay.** Needs nothing from the plugin API. The plugins' content moves into the bars'
popovers or a `plugins` system plugin (SYSP `plugins`), and the three places become runtime code no one
can replace (design rule 2, ADR 0026).

**Both stay.** Needs nothing. Two implementations of each place keep drifting, and a community plugin
that wants an edge is off under every sample profile.

## Decision Outcome

Recommendation: "`plugins/{dock,toolbar,sidebar}` stay", following ADR 0026. Each takes in its shell
part when the API covers it, the rail first (its main gaps are #73 and #74), then the bottom edge, and the
agent bar last, since it needs role slots and a system layer. A pair is merged in one task: the plugin
gains the part, the shell's code goes and `plugins/shell`'s sample profiles stop turning that plugin
off. Until then both stay as they are. The requirements draft already names the three `agents`, `rail`
and `dock` (SYSP); whether the folders and ids follow is left to each move.

### Consequences

* Good, because each place has one implementation that a profile turns on or off like any plugin.
* Good, because the gaps are the ones every status, dock or agent plugin from the community would hit.
* Bad, because the shell's bars float over the desk while edge surfaces sit in bars beside the grid
  (`packages/runtime/src/edges.ts`); one look has to give way.
* Bad, because the agent bar, in a frame, needs the system layer in the plugin API before it can move.

## More Information

`plugins/{dock,toolbar,sidebar,shell}/README.md`, `packages/runtime/src/system/layer.ts`,
`packages/runtime/ASSUMPTIONS.md` (41). Related: ADR 0023, 0025, 0026, 0027. In flight: #73, #74, #77.
Requirements: SYSP `agents`, `rail`, `dock` in `docs/ko/desk-requirements.md`.
