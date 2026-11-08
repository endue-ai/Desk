---
status: proposed
date: 2026-10-30
decision-makers: Team endue
---

# One Eris: which implementation stays

## Context and Problem Statement

Eris exists twice at `99ee07d`:

* `plugins/eris` (`endue.eris`, #14 and #41) is a UI plugin with a `right` surface. It draws her from the
  brand poses and an orb assembled on a timeline (ADR 0013), talks over `brain.say` and `brain.turn`
  (ADR 0014), speaks with the Web Speech API and renders soul text from word times or plain text
  (`plugins/eris/ui/{orb,talk,voice,soul-text}.js`). The first run imports its orb and soul text through
  an import map (`plugins/onboarding/ui/index.html`).
* `packages/runtime/src/eris` (#70) is the shell's: a canvas mesh in six states, Dysnomia, sound rings
  from audio bands and soul text from word times (`packages/runtime/src/eris/{Eris,mesh,voice,SoulText}.ts`).
  She is dragged anywhere and her position is kept in the profile's layout (`desk.shell.mode`,
  `desk.shell.layouts`). She hears the host through `ShellBridge` (`packages/runtime/src/bridge/types.ts`): `audio.levels()` and
  the talk line's `brain.say`, which answers with word times.

The shell's pages install no Eris plugin (`packages/runtime/ASSUMPTIONS.md`, 44), so the shell shows its
own and the bare desk and the first run show the plugin's: two looks, two soul text engines, two voices.
Which one stays, and what does the plugin API lack for the other to fold into it?

```bash
find plugins/eris/ui -maxdepth 1 \( -name '*.js' -o -name '*.css' -o -name '*.html' \) -exec cat {} + | wc -l   # 1049
find packages/runtime/src/eris -maxdepth 1 \( -name '*.ts' -o -name '*.css' \) -exec cat {} + | wc -l           # 1624
```

## Decision Drivers

* One Eris, the same in the first run, on the bare desk and in the shell
* Eris is a built-in that can be replaced (design rule 2); ADR 0026 governs where the shell's parts go
* What she needs should be bridge methods any voice or assistant plugin can use
* Audio stays in the core in v0 (SYS-04); only what is derived from it may cross the bridge

## Considered Options

* `plugins/eris` stays; the shell's mesh, rings and soul text fold into it
* `packages/runtime/src/eris` stays; the plugin goes and the first run plays on the shell's Eris

**`plugins/eris` stays.** The shell's Eris becomes the plugin's body, which needs from the plugin API:

| Need | At the base commit | Status |
| --- | --- | --- |
| Audio levels (the person's and hers, nine bands each) | `audio.capture.start`, `stop` and the `audio.wake` event only (`specs/bridge/v0/audio.schema.json`), all `unsupported` in `crates/desk-core/src/handler.rs` | not specified |
| The brain's streamed text | `brain.say` and `brain.turn` deltas (`specs/bridge/v0/brain.schema.json`), served by the core | specified |
| Her voice and the soul text's timing | word times and the voice's audio are not in `brain.turn`; `ShellBridge` returns `words`, the bridge does not | not specified |
| A dragged floating placement | `floating` is a `SurfacePlacement`, but the runtime puts it on the grid like `center` (`packages/runtime/src/edges.ts`, `takesCell`). No position, no drag, no frame above the other surfaces, and the position a profile keeps is the shell's setting, which a plugin cannot write (`settings.*` `unsupported`) | not specified (#81 serves settings) |
| The agent directory | neither Eris reads it today; handing work to agents (AG-10) needs it from a frame. `specs/brain/v0/openapi.yaml` lists agents; the bridge has no method | not specified (#74 adds `brain.agents.*`) |

The shell's commands for her (`desk.shell.density-balanced`, `desk.shell.soul-wisp` and their siblings)
and the talk line's calls to her would be commands the plugin answers, which `cmd.*` already serves
(ADR 0017).

**`packages/runtime/src/eris` stays.** The plugin goes. Needs from the plugin API:

| Need | At the base commit | Status |
| --- | --- | --- |
| The first run drives the shell's Eris | `cmd.invoke` is served, but the shell defines no command for her arrival or gestures (listen, turn, shrink, heads-up) | not specified |
| The first run's orb and soul text | frames load plugin files (their own, or another plugin's as the first run does) and the bundled SDK; no runtime module is served to them | not specified |
| Eris without the shell | the bare desk (`apps/desk/src/main.ts` mounts `createRuntime`) would have none | #74 mounts the shell |

Eris would stay runtime code that no plugin can replace, the hole ADR 0026 is about.

## Decision Outcome

Recommendation: "`plugins/eris` stays", following ADR 0026. The shell's mesh body, rings and soul text
move into the plugin when the bridge has audio levels and word times and the plugin API has a dragged
floating placement whose position a profile keeps; then `packages/runtime/src/eris` goes. Until then
the shell keeps its own Eris and the plugin keeps the first run and the bare desk. Which look survives
(the brand poses or the mesh) is a design choice this ADR leaves to the person; the move is the same
either way.

### Consequences

* Good, because the first run, the bare desk and the shell show one Eris, and someone can replace her.
* Good, because levels, word times and a floating placement serve every voice or assistant plugin.
* Bad, because levels at animation rate are a new event stream, one message per frame while she
  listens or speaks, and the spec must say they are energies, not audio (SYS-04).
* Bad, because until the move two soul text engines and two voices drift apart.

## More Information

`plugins/eris/README.md`; `packages/runtime/ASSUMPTIONS.md` (4, 7–15, 42); ADR 0013, 0014, 0024, 0026,
0028. In flight: #73 (events), #74 (the shell in the app, the agent directory), #81 (settings).
Requirements: SYSP `eris`, AG-10, SYS-04 in `docs/ko/desk-requirements.md`.
