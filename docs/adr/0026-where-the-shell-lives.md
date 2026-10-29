---
status: proposed
date: 2026-10-30
decision-makers: Team endue
---

# Where the desk shell lives: the runtime, its own package, or plugins

## Context and Problem Statement

The shell (#70; ADR 0023, 0025) is `mountDesk` in `packages/runtime`: the system layer, profiles and
desktops 1–4, the floating windows and their panes, Eris, the rail and the bottom edge, in
`packages/runtime/src/{shell,surface,system,modes,eris}`. Design rule 2 says built-ins use the same API
as community plugins and rule 9 that `plugins/` keeps one folder format; ADR 0010 expected the runtime to
stay "a few hundred lines". `packages/runtime/ASSUMPTIONS.md` (2) put the shell in the runtime because
the plugin API cannot place chrome yet, and said it can move into `plugins/` once it can. Where should
the shell live, and what would the plugin API need for it to be plugins?

Sizes at `99ee07d`, in lines of `*.ts` and `*.css`, tests included:

```bash
find packages/runtime/src/{shell,surface,system,modes} -maxdepth 1 \( -name '*.ts' -o -name '*.css' \) -exec cat {} + | wc -l   # 5214
find packages/runtime/src/eris -maxdepth 1 \( -name '*.ts' -o -name '*.css' \) -exec cat {} + | wc -l                          # 1624
find packages/runtime/src -path '*/src/shell' -prune -o -path '*/src/surface' -prune -o -path '*/src/system' -prune \
  -o -path '*/src/modes' -prune -o -path '*/src/eris' -prune -o \( -name '*.ts' -o -name '*.css' \) -print \
  | xargs cat | wc -l                                                                                                        # 5358, the rest
```

The shell reaches the host through `ShellBridge` (`packages/runtime/src/bridge/types.ts`): audio
levels, the brain's status and replies with word times, the agent directory (ADR 0024). No bridge method
serves them at the base; #74 adds the directory and the brain's status when it mounts the shell in the
Tauri app, which still mounts the bare runtime (`apps/desk/src/main.ts`).

## Decision Drivers

* Built-ins use the plugin API, so the API has no holes and a built-in can be replaced (rules 2 and 9)
* The runtime is the window manager: compositor, surfaces, input, layout and the policies' mechanisms
  (ADR 0010, 0017)
* The system layer stays where the person left it; no profile may hide it (ADR 0023)
* No move now that the next move throws away
* The shell keeps working while the API grows (#73, #76, #77 and #81 are in flight)

## Considered Options

* Stay in `packages/runtime`
* A separate `@endue-ai/shell` package over the runtime's public API
* Plugins in `plugins/`, once the plugin API covers chrome placement

**Stay in `packages/runtime`.** Needs nothing from the plugin API. Rule 2 keeps a known hole, and the
runtime keeps about 6.8k lines of features beside its own 5.4k.

**A separate package.** Needs nothing from the plugin API: a package is host code, like the runtime. It
needs the runtime to export what the shell imports from its internals today, ten modules: `views`,
`rebind`, `commands`, `plugins`, `runtime`, `input`, `clock`, `ease`, the keys policy
(`packages/runtime/src/policies/keys.ts`) and the `ShellBridge` types, which would move with it.

```bash
grep -hoE 'from "(\.\./)+[a-z/-]+"' $(ls packages/runtime/src/{shell,surface,system,modes,eris}/*.ts \
  packages/runtime/src/surface/samples/*.ts | grep -v '\.test\.ts$') | sed -E 's#from "(\.\./)+##; s#"##' \
  | grep -vE '^(shell|surface|system|modes|eris)(/|$)' | sort -u                                          # 10 modules
```

The shell would still not be plugins, and moving into `plugins/` later moves the code a second time.

**Plugins in `plugins/`.** Each part becomes a UI plugin, which needs from the plugin API:

| Need | At the base commit | Status |
| --- | --- | --- |
| Edge placement for chrome | `SurfacePlacement` is `center · left · right · bottom · overlay · floating` (`specs/plugin/v0/plugin.schema.json`); edge surfaces share a bar per side in mount order (`packages/runtime/src/edges.ts`). No top edge or corner (the profile switcher sits top left, the desktops top right), no layer above the mode layer, no bar floating over the desk | not specified |
| `ui.surface.open` / `close` | specified (`specs/bridge/v0/ui.schema.json`), answered `unsupported` (`crates/desk-core/src/handler.rs`); a plugin opens only its own declared surfaces, with no position | #77 in flight (core side) |
| Events | `events.subscribe` specified (`specs/bridge/v0/events.schema.json`), answered `unsupported`; its six names hold no surface, focus, profile or desktop event | #73 in flight |
| Role slots | `provides` (BR-05) is not in the manifest schema, so nothing marks the system layer's plugins as ones a profile cannot turn off (ADR 0023) | not specified |
| The host's data | `ShellBridge`'s audio levels and word times have no bridge method; the agent directory and the brain's status get one in #74 | partly in flight |
| Settings while Desk runs | `desk.shell.mode` and `desk.shell.layouts` change at run time; a plugin reads only its own `init.yaml` settings (`init.get`), and `settings.*` answers `unsupported` | #81 in flight |

Under every option the floating windows and their panes stay the window manager's: they show host views
(`packages/runtime/src/views.ts`), and a plugin frame cannot hold another plugin's surface.

## Decision Outcome

Recommendation: "plugins in `plugins/`", moved one part at a time as the API covers it, with no
`@endue-ai/shell` package in between. Until a part's API exists, that part stays in `packages/runtime`
and keeps working as it does. `packages/runtime/src/surface` and `packages/runtime/src/modes` (the
windows, panes and what a profile lays out on desktops 1–4) are window management and stay in the
runtime as its pane tree and layout (RT-02), not plugins.

Suggested order, from the smallest gap: the rail into `plugins/toolbar`, the bottom edge into
`plugins/dock`, Eris into `plugins/eris` (ADR 0027), then the agent bar into `plugins/sidebar` (ADR 0028)
and the profile and desktop switchers last, since those two and the agent bar need role slots and a
system layer. The three edge plugins' READMEs already list the shell's parts as their "Later".

### Consequences

* Good, because every gap is a bridge method, a placement or a manifest field that community plugins get
  too, so rule 2 holds by construction once a part has moved.
* Good, because nothing moves now: #74 mounts the shell in the Tauri app where it is.
* Bad, because until the moves, principle 2 has a documented hole and the runtime stays far over ADR
  0010's "few hundred lines".
* Bad, because chrome in frames costs an iframe each plus bridge messages, the risk the design's stack
  table already names for UI plugins.
* Bad, because chrome placement, a layer and role slots widen the v0 plugin API (ADR 0004).

## More Information

`packages/runtime/ASSUMPTIONS.md` (2, 3), `packages/runtime/src/shell/Desk.ts`,
`packages/runtime/src/system/layer.ts`, `plugins/shell/README.md`. Related: ADR 0027 (Eris) and 0028 (the
edges), which follow this recommendation. In flight: #73 (events), #74 (the shell in the app), #76
(WIT), #77 (`ui.surface`), #81 (settings). Design: `docs/ko/desk-structure.md`, principle 2 and the
`packages/runtime` entry. Accepting it is flipping `status` to `accepted`, in a one-line PR or in the
first task that moves a part.
