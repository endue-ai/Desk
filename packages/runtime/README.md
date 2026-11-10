# @endue-ai/runtime

The desk in the webview: sandboxed surfaces, input, theme and core settings, the default policies
(ADR 0017), and the shell (ADR 0023, 0025). Plain TypeScript and DOM (ADR 0010); animations use an
injected clock (ADR 0013). Shell decisions not in the brief: `ASSUMPTIONS.md`.

## Public API

- `createRuntime({ root, bridge, clock?, storage?, platform?, language?, plugins?, themeRoot?, views?, windows?, pickFile? })`
  returns `Runtime`: `ready`, `openSurface`, `closeSurface`, `moveSurface`, `focusSurface`, `layout()`,
  `status()`, `shortcuts`, `commands`, `settings`, `preferences`, `settingsWindow`, `keymap`, `buffers`,
  `profiles`, `policy()`, `notify(notice)`, `theme()`, `themes` (ADR 0056), `onQuit`, `keep(name, part)`,
  `plugins`, `dispose()`. Core settings work without plugins (ADR 0055); `~/.desk/keys.yaml` (ADR 0079).
- `PluginHost`: mounts UI plugins, relays calls as their caller, reloads on `plugin.changed`, carries
  commands and keys, shares themes (ADR 0012, 0014); `Owners` routes events to their owner or manage
  holders. `frames/` carries out which windows keep a live frame (ADR 0070, ADR 0158).
- Policies: `collect(plugins)`, `Commands`, layered `Settings`, `Keymap` (personal bindings last;
  `rebind.ts`), `decide`, `resolveTheme`, `Notifications`, `Buffers`; `src/policies/*` applies them.
  `HostViews` (`views.ts`) connects host-drawn views to focus and buffers.
- `mountDesk({ root, bridge, core, plugins, windowManager, clock?, lang?, platform?, epoch?, seed? })`:
  the shell over its runtime, holding plugin surfaces as windows (ADR 0040); `windowManager` (desk-wm,
  ADR 0158) holds every window, pane, desktop, the drawer and the pan, takes the shell's edits and
  publishes the desk (`wm/`); `localWindowManager` runs it as WebAssembly without the compositor.
  Returns `{ store, eris, runtime, ready, hold, … }`. Desktops: a named list of up to 32 (ADR 0117).
  A click on Eris is a spoken turn (`eris/talk.ts`); `desk.propose` makes views, profiles and keys
  from a sentence (ADR 0073, 0102).
- `ShellBridge` (audio, brain voice, agent directory, `localAgents` (ADR 0110), `studio` (ADR 0129));
  `browserBridge`, `browserCore` for pages and tests. `ShortcutRouter`, `comboOf`, `canonical`,
  `formatCombo`; clock `realClock`, `ManualClock`, `tween`; `SurfaceHost`; `applyTheme`; `desk.css`.

## Run and test
```bash
pnpm dev                                  # shell at http://127.0.0.1:5173 (Shift+U / Shift+E: rings)
pnpm exec vitest run packages/runtime      # unit; builds desk-wm as WebAssembly when it is stale
just test-e2e                             # Playwright on stubs, never directly; macOS: Linux (ADR 0018)
```

Fixtures: `desk.html` (desk.* policies, test plugins), `shell.html` (`?lang=en`, `?persist=1`,
`?reduced=1`, `?init=`, `?views=1`, `?apps=1`; desk-wm from `/desk-wm.wasm`, `__shell.wm` moves windows
through it), `views.html`, `safe-mode.html` (ADR 0061). Render trees (ADR 0011): `--update-snapshots`.
