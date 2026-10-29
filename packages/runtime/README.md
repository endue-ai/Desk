# @endue-ai/runtime

Shell and window manager: the 2D compositor, sandboxed surfaces, input routing, layout and theme.
No 3D yet.

Layer: Web runtime (see `docs/architecture.md`). Plain TypeScript and DOM (ADR 0010).

## Public API

- `createRuntime({ root, bridge, clock?, storage?, platform?, plugins? })` mounts the desk and returns
  a `Runtime`: `ready`, `openSurface`, `closeSurface`, `moveSurface`, `focusSurface`, `layout()`,
  `status()`, `shortcuts`, `plugins` (`ready`, `mounted()`), `dispose()`.
- `PluginHost` (used when `plugins: { url }` is given): mounts enabled UI plugins from `plugin.list`,
  relays their batched calls with the plugin as caller, reloads one surface on `plugin.changed`
  (updated) and keeps the plugin's state; honours `placement: "overlay"` and the edges; `plugins.command(id, name,
  args)` sends a plugin a command; ADR 0012. `brain.turn` events go only to the plugin whose
  `brain.say` started the turn (events that arrive before the answer wait for it); ADR 0014.
- `ShortcutRouter`, `comboOf`: "Mod+K" style bindings, focused surface first, then global.
- Layout: `defaultLayout`, `loadLayout`, `saveLayout`, `place`, `move`, `remove`.
- Clock: `realClock`, `ManualClock` (inject in tests), `tween`.
- `SurfaceHost`: iframes with `sandbox="allow-scripts"` only. `applyTheme`.
- Edges: `left`, `right` and `bottom` surfaces sit in bars around the grid (240, 320 and 72 px, shared
  in mount order), without a title bar or a grid cell; a bar exists only while it holds a surface.
- `@endue-ai/runtime/desk.css`: the desk stylesheet.

## Testing

```bash
pnpm exec vitest run packages/runtime    # unit
just test-e2e                            # Playwright on the browser stub (macOS: Linux container)
```

`e2e/` uses fixture pages with the browser bridge stub and a manual clock (`plugins.html` adds two UI
plugins served by the fixture's Vite config). Render snapshots are
serialised render trees (ADR 0011); update them with `just test-e2e --update-snapshots` and review
the JSON diff. Playwright never runs directly: the configs refuse native WebKit on macOS (ADR 0018).
