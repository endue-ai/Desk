# @endue-ai/runtime

The desk in the webview: the 2D compositor, sandboxed surfaces, input, layout and theme, the mechanisms
the desk's default policies drive (ADR 0017), and the shell on top (ADR 0023, 0025). No 3D yet. Plain
TypeScript and DOM (ADR 0010); every animation runs on an injected clock (ADR 0013).

## Public API

- `createRuntime({ root, bridge, clock?, storage?, platform?, plugins?, themeRoot?, views? })` returns a
  `Runtime`: `ready`, `openSurface`, `closeSurface`, `moveSurface`, `focusSurface`, `layout()`,
  `status()`, `shortcuts`, `commands`, `settings`, `keymap`, `buffers`, `profiles`, `policy()`,
  `notify(notice)`, `theme()`, `onQuit`, `keep(name, part)`, `plugins`, `dispose()`.
- `PluginHost`: mounts enabled UI plugins, relays their calls as their own caller, reloads a surface on
  `plugin.changed`, carries commands both ways and keys from frames, shares the theme (ADR 0012, 0014).
  `Owners` (`owners.ts`) sends brain turns, fs watches and processes only to the plugin whose call
  started them, holding events that arrive before the call's answer.
- Policies: `collect(plugins)`, `Commands` (the core's registry), layered `Settings`, `Keymap` (the
  person's layer `desk.keys.bindings` last; `rebind.ts` edits it), `decide`, `resolveTheme`,
  `Notifications`, `Buffers`; `src/policies/*` applies one desk.* policy each. `HostViews` (`views.ts`):
  views a host draws itself take part in focus cycling and buffers.
- `mountDesk({ root, bridge, core, plugins, clock?, lang?, platform?, epoch? })`: the shell in two
  layers (system: profiles, desktops, agent bar; mode: Eris, rail, bottom edge, surfaces) over a runtime
  it creates. Returns `{ store, ticker, eris, runtime, ready, refresh, dispose }`. Its commands, keys,
  profiles (`desk.shell.mode`), colours (`--desk-*`) and saved state are the runtime's; `plugins/shell`.
- `ShellBridge` (audio, the brain's voice, the agent directory of specs/brain/v0, ADR 0024);
  `browserBridge` and `browserCore` (the core's stub: cmd.*, plugins, store, init) for pages and tests.
- `ShortcutRouter`, `comboOf`, `canonical`, `formatCombo`; layout `place`, `move`, `remove`; clock
  `realClock`, `ManualClock`, `tween`; `SurfaceHost`; `applyTheme`; `desk.css`; edge bars.

## Run and test

```bash
pnpm dev                                  # the shell at http://127.0.0.1:5173 (Shift+U / Shift+E: rings)
pnpm exec vitest run packages/runtime     # unit: policies, keymap, profiles, mesh, voice, soul, contrast
just test-e2e                             # Playwright on the stubs (macOS: a Linux container, ADR 0018)
```

Fixtures: `desk.html` (the desk.* policies' real plugin.json with test plugins; `?init=`, `?off=`,
`?platform=`, `?profile=`, `?rules=`, `?store=`) and `shell.html` (`?lang=en`, `?persist=1`,
`?reduced=1`, `?init=`). Snapshots are render trees (ADR 0011); update with `just test-e2e
--update-snapshots` and review the JSON diff. Playwright never runs directly (ADR 0018). Shell
decisions not in the brief: `ASSUMPTIONS.md`.
