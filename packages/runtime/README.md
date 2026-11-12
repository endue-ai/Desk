# @endue-ai/runtime

The desk's system surface (ADR 0160): the page the compositor draws above every window, with the
desk's policies, input, theme and settings (ADR 0017), the plugin host and the shell's parts (ADR 0023,
0025). It moves no window (desk-wm does, ADR 0158); in the app it holds no plugin frame (each a browser
of its own) and lays each window out in a page of its own (`windowPages`, ADR 0201). Plain TS and DOM (ADR 0010);
animations use an injected clock (ADR 0013). Shell decisions not in the brief: `ASSUMPTIONS.md`.

## Public API

- `createRuntime({ root, bridge, clock?, platform?, language?, plugins?, pages?, themeRoot?, views?, windows?, pickFile? })`
  returns `Runtime`: `ready`, `openSurface`, `closeSurface`, `focusSurface`, `status()`, `shortcuts`,
  `commands`, `settings`, `preferences`, `settingsWindow`, `keymap`, `buffers`, `profiles`, `policy()`,
  `notify`, `theme()`, `themes` (ADR 0056), `onQuit`, `keep(name, part)`, `plugins`, `dispose()`. Without
  a window host its surfaces sit side by side in the order they opened; edge bars hold the dock.
- `SurfacePages` (`pages/`): `remotePages(win, transport)` in the app (the section holds the surface's
  place, `data-surface-host` with two Tab edges; the plugin host posts to a port the shell carries by
  host); `framePages()`, sandboxed frames of this page, without the compositor. `surfaceHostOf(src)`.
- `PluginHost`: mounts UI plugins, relays calls as their caller, reloads on `plugin.changed`, carries
  commands, keys and themes (ADR 0012, 0014); `Owners` routes events. `frames/`: the live set (ADR 0158).
- Policies: `collect(plugins)`, `Commands`, layered `Settings`, `Keymap` (`rebind.ts`), `decide`,
  `resolveTheme`, `Notifications`, `Buffers`; `src/policies/*` applies them.
- `mountDesk({ root, bridge, core, plugins, windowManager, pages?, windowPages?, clock?, lang?, … })`:
  the shell over its runtime; `windowManager` (desk-wm) holds the windows, panes, desktops (up to 32,
  ADR 0117), the drawer and the pan (`wm/`); `localWindowManager` runs it as WebAssembly without the
  compositor. Returns `{ store, eris, runtime, ready, hold, … }`.
- `ShellBridge`, `browserBridge`, `browserCore`; `ShortcutRouter`, `comboOf`, `canonical`, `formatCombo`;
  `realClock`, `ManualClock`, `tween`; `SurfaceHost`; `applyTheme`; `desk.css`.

## Run and test
```bash
pnpm dev                                  # shell at http://127.0.0.1:5173 (Shift+U / Shift+E: rings)
pnpm exec vitest run packages/runtime      # unit; builds desk-wm as WebAssembly when it is stale
just test-e2e                             # Playwright on stubs, never directly; macOS: Linux (ADR 0018)
```

Fixtures: `system.html` (the system surface as the app runs it, the fixture playing the shell),
`desk.html` (desk.* policies, test plugins), `shell.html` (`?lang=en`, `?persist=1`, `?reduced=1`,
`?init=`, `?views=1`, `?apps=1`; desk-wm from `/desk-wm.wasm`, `__shell.wm`), `views.html`,
`safe-mode.html` (ADR 0061). Render trees: `--update-snapshots`.
