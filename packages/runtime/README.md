# @endue-ai/runtime

The desk in the webview: the 2D compositor, sandboxed surfaces, input, layout and theme, the mechanisms
the desk's default policies drive (ADR 0017), and the shell on top (ADR 0023, 0025). No 3D yet. Plain
TypeScript and DOM (ADR 0010); every animation runs on an injected clock (ADR 0013). Shell decisions
not in the brief: `ASSUMPTIONS.md`.

## Public API

- `createRuntime({ root, bridge, clock?, storage?, platform?, plugins?, themeRoot?, views?, windows? })` returns a
  `Runtime`: `ready`, `openSurface`, `closeSurface`, `moveSurface`, `focusSurface`, `layout()`,
  `status()`, `shortcuts`, `commands`, `settings`, `keymap`, `buffers`, `profiles`, `policy()`,
  `notify(notice)`, `theme()`, `onQuit`, `keep(name, part)`, `plugins`, `dispose()`.
- `PluginHost`: mounts UI plugins, relays their calls as their own caller, reloads a surface on
  `plugin.changed`, carries commands and keys, shares the theme (ADR 0012, 0014); events go to their
  owner (`fs.changed`, `data.changed`) or to `*:manage` holders. A shown overlay goes on top.
  `Owners` (`owners.ts`) does that routing for brain turns, fs watches, data subscriptions and
  processes, holding events that arrive before the call's answer.
- Policies: `collect(plugins)`, `Commands` (the core's registry), layered `Settings`, `Keymap` (the
  person's layer `desk.keys.bindings` last; `rebind.ts`), `decide`, `resolveTheme`, `Notifications`,
  `Buffers`; `src/policies/*`, one desk.* policy each. `HostViews` (`views.ts`): focus and buffers.
- `mountDesk({ root, bridge, core, plugins, clock?, lang?, platform?, epoch?, seed? })`: the shell (system
  layer: profiles, desktops, agent bar; mode layer: Eris, rail, bottom edge, surfaces) over its own
  runtime, whose centre and floating plugin surfaces it holds as its windows (ADR 0040); returns
  `{ store, ticker, eris, runtime, ready, refresh, dispose }` (`plugins/shell`).
- `ShellBridge` (audio, the brain's voice, the agent directory of specs/brain/v0, ADR 0024);
  `browserBridge`, `browserCore` (the core's stub: cmd.*, plugins and built-in grants, store, init,
  fixture items, `upsert`, `remove`) for pages and tests.
- `ShortcutRouter`, `comboOf`, `canonical`, `formatCombo`; layout `place`, `move`, `remove`; clock
  `realClock`, `ManualClock`, `tween`; `SurfaceHost`; `applyTheme`; `desk.css`; edge bars.

## Run and test

```bash
pnpm dev                                  # the shell at http://127.0.0.1:5173 (Shift+U / Shift+E: rings)
pnpm exec vitest run packages/runtime     # unit: policies, keymap, profiles, mesh, voice, soul, contrast
just test-e2e                             # Playwright on the stubs (macOS: a Linux container, ADR 0018)
```

Fixtures: `desk.html` (desk.* policies, test plugins; `?init=`, `?off=`, `?platform=`, `?profile=`,
`?rules=`, `?store=`), `shell.html` (`?lang=en`, `?persist=1`, `?reduced=1`, `?init=`), `views.html`
(desk.views on the fixture items; `?status=error`, `?jira=1`). Render-tree snapshots (ADR 0011):
`just test-e2e --update-snapshots`, then review the JSON. Never run Playwright directly (ADR 0018).
