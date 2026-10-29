# @endue-ai/runtime

Shell and window manager: the 2D compositor, sandboxed surfaces, input, layout and theme, and the
mechanisms the desk's default policies drive (ADR 0017). No 3D yet. Plain TypeScript and DOM (ADR 0010).

## Public API

- `createRuntime({ root, bridge, clock?, storage?, platform?, plugins? })` returns a `Runtime`:
  `ready`, `openSurface`, `closeSurface`, `moveSurface`, `focusSurface`, `layout()`, `status()`,
  `shortcuts`, `commands`, `settings`, `policy()`, `notify(notice)`, `theme()`, `plugins`, `dispose()`.
- `PluginHost`: mounts enabled UI plugins (hidden ones stay hidden until they show themselves), relays
  their calls as their own caller, reloads one surface on `plugin.changed`, carries commands both ways
  and keys from frames, shares the theme, and routes `brain.turn` and `fs.changed` events only to the
  plugin that started them (ADR 0012, 0014).
- Policies: `collect(plugins)` layers every enabled plugin's `contributes`; `Commands` (built-ins exist
  while their policy plugin is on), layered `Settings`, `resolveKeymap`/`Keymap`, `decide` (display
  rules), `resolveTheme`, `Notifications`, `Buffers`. `src/policies/*` applies one desk.* policy each:
  theme, keys, notify, display, buffers, files, session, profiles.
- `ShortcutRouter`, `comboOf`, `canonical`, `formatCombo`; layout `place` (with a size), `move`, `remove`;
  clock `realClock`, `ManualClock`, `tween`; `SurfaceHost`; `applyTheme`; `desk.css`.

## Testing

```bash
pnpm exec vitest run packages/runtime    # unit
just test-e2e                            # Playwright on the browser stub (macOS: Linux container)
```

`e2e/` uses fixture pages with the browser bridge stub and a manual clock (`plugins.html` adds two UI
plugins served by the fixture's Vite config; `desk.html` runs the real `plugins/*/plugin.json` of the
desk.* policies with a test plugin, and takes `?init=`, `?off=`, `?platform=`, `?profile=`, `?rules=` and
`?store=`). Render snapshots are serialised render trees (ADR 0011); update them with
`just test-e2e --update-snapshots` and review the JSON diff. Playwright never runs directly: the configs
refuse native WebKit on macOS (ADR 0018).
