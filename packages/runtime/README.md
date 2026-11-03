# @endue-ai/runtime

The desk in the webview: the 2D compositor, sandboxed surfaces, input, layout, theme and core settings,
the default policies (ADR 0017), and the shell (ADR 0023, 0025). Plain TypeScript and DOM (ADR 0010);
animations use an injected clock (ADR 0013). Shell decisions not in the brief: `ASSUMPTIONS.md`.

## Public API

- `createRuntime({ root, bridge, clock?, storage?, platform?, language?, plugins?, themeRoot?, views?, windows?, pickFile? })`
  returns `Runtime`: `ready`, `openSurface`, `closeSurface`, `moveSurface`, `focusSurface`, `layout()`,
  `status()`, `shortcuts`, `commands`, `settings`, `preferences`, `settingsWindow`, `keymap`, `buffers`,
  `profiles`, `policy()`, `notify(notice)`, `theme()`, `themes` (installed, active, preview, apply,
  resolve; ADR 0056), `onQuit`, `keep(name, part)`, `plugins`, `dispose()`.
- Core: `desk.settings.open` (`Mod+,`), `desk.settings.keyboard`, `settingsWindow.open(section?)` and
  the `preferences` store work without plugins (ADR 0055); personal bindings: `~/.desk/keys.yaml` (ADR 0079).
- `PluginHost`: mounts UI plugins, relays calls as their caller, reloads on `plugin.changed`, carries
  commands and keys, shares themes (ADR 0012, 0014); `Owners` routes events to their owner or manage
  holders, holding early ones. A shown overlay goes on top; `frames/` unloads hidden ones (ADR 0070).
- Policies: `collect(plugins)`, `Commands`, layered `Settings`, `Keymap` (personal bindings last;
  `rebind.ts`), `decide`, `resolveTheme`, `Notifications`, `Buffers`; `src/policies/*` applies them.
  Keys are always on. `HostViews` (`views.ts`) connects host-drawn views to focus and buffers.
- `mountDesk({ root, bridge, core, plugins, clock?, lang?, platform?, epoch?, seed? })`: the shell over
  its runtime, holding centre and floating plugin surfaces as windows (ADR 0040); returns `{ store,
  ticker, eris, runtime, ready, refresh, dispose }` (`plugins/shell`). Its `desk.propose` (ADR 0073)
  turns a sentence into a view, a profile or key bindings by `brain.ask` (ADR 0059), then previews it.
- `ShellBridge` (audio, brain voice, agent directory; ADR 0024); `browserBridge`, `browserCore` (cmd.*,
  plugins, grants, store, init, the desk folder, fixture items, `upsert`, `remove`, `brain.ask`) for
  pages and tests. `ShortcutRouter`, `comboOf`, `canonical`, `formatCombo`; layout `place`, `move`,
  `remove`; clock `realClock`, `ManualClock`, `tween`; `SurfaceHost`; `applyTheme`; `desk.css`.

## Run and test
```bash
pnpm dev                                  # shell at http://127.0.0.1:5173 (Shift+U / Shift+E: rings)
pnpm exec vitest run packages/runtime      # unit: policies, keymap, profiles, mesh, voice, contrast
just test-e2e                             # Playwright on stubs, never directly; macOS: Linux (ADR 0018)
```

Fixtures: `desk.html` (`?init=`, `?off=`, `?platform=`, `?profile=`, `?rules=`, `?store=`, `?core=1`),
`shell.html` (`?lang=en`, `?persist=1`, `?reduced=1`, `?init=`, `?views=1`, `?apps=1`), `views.html` (`?status=error`,
`?jira=1`, `?propose=1`). Render trees (ADR 0011): `just test-e2e --update-snapshots`, review the JSON.
