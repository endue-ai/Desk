# @endue-ai/runtime

The desk in the webview: the 2D compositor, sandboxed surfaces, input, layout and theme, the mechanisms
the desk's default policies drive (ADR 0017), and the shell on top (ADR 0023, 0025). Plain TypeScript
and DOM (ADR 0010); animations run on an injected clock (ADR 0013). Shell decisions: `ASSUMPTIONS.md`.

## Public API

- `createRuntime({ root, bridge, clock?, storage?, platform?, plugins?, themeRoot?, views?, windows? })` returns a
  `Runtime`: `ready`, `openSurface`, `closeSurface`, `moveSurface`, `focusSurface`, `layout()`,
  `status()`, `shortcuts`, `commands`, `settings`, `keymap`, `buffers`, `profiles`, `policy()`,
  `notify(notice)`, `theme()`, `themes` (installed, active, preview, apply, resolve: what the theme
  studio drives, ADR 0056), `onQuit`, `keep(name, part)`, `plugins`, `dispose()`.
- `PluginHost`: mounts UI plugins, relays their calls as their own caller, reloads a surface on
  `plugin.changed`, carries commands and keys, shares the theme (ADR 0012, 0014). `Owners` routes
  events to their owner (brain turns, fs watches, data subscriptions, processes) or to `*:manage`
  holders, holding those that arrive before the call's answer. A shown overlay goes on top.
- Policies: `collect(plugins)`, `Commands` (the core's registry), layered `Settings`, `Keymap` (the
  person's layer `desk.keys.bindings` last; `rebind.ts`), `decide`, `resolveTheme`, `Notifications`,
  `Buffers`; `src/policies/*`, one desk.* policy each. `HostViews` (`views.ts`): focus and buffers.
- Start (ADR 0061): `StartInfo` and `relaunch` become notices with actions and a Safe mode badge.
- `mountDesk({ root, bridge, core, plugins, clock?, lang?, platform?, epoch?, seed?, start?, relaunch? })`: the shell (system
  layer: profiles, desktops, agent bar; mode layer: Eris, rail, bottom edge, surfaces) over its own
  runtime, whose centre and floating plugin surfaces it holds as its windows (ADR 0040); returns
  `{ store, ticker, eris, runtime, ready, refresh, dispose }` (`plugins/shell`). It installs
  `desk.propose` (`src/propose`, ADR 0073): a sentence to a view by `brain.ask` (ADR 0059), checked
  against the spec's schema, previewed in desk.views, applied with `view.save`.
- `ShellBridge` (audio, the brain's voice, the agent directory, ADR 0024); `browserBridge`,
  `browserCore` (the core's stub: cmd.*, plugins and built-in grants, store, init, fixture items,
  `upsert`, `remove`, `brain.ask` by `ask` or a scripted `brain`) for pages and tests;
  `ShortcutRouter`, `comboOf`, layout `place`/`move`/`remove`, `realClock`, `ManualClock`, `tween`.

## Run and test

`pnpm dev` (the shell at http://127.0.0.1:5173), `pnpm exec vitest run packages/runtime` (unit), and
`just test-e2e` (Playwright on the stubs; macOS: a Linux container, ADR 0018). Fixtures: `desk.html` (desk.* policies, test plugins; `?init=`, `?off=`, `?platform=`, `?profile=`,
`?rules=`, `?store=`), `shell.html` (`?lang=en`, `?persist=1`, `?reduced=1`, `?init=`, `?views=1`),
`views.html` (desk.views on the fixture items; `?status=error`, `?jira=1`, `?propose=1`), `safe-mode.html`
(`?safe=`, `?held=`, `?broken=`, `?throws=1`, `?session=torn`; ADR 0061). Render
trees (ADR 0011): `just test-e2e --update-snapshots`, review the JSON. Never run Playwright directly.
