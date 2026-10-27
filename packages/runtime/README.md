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
  (updated) and keeps the plugin's state; honours `placement: "overlay"`; `plugins.command(id, name,
  args)` sends a plugin a command; ADR 0012.
- `ShortcutRouter`, `comboOf`: "Mod+K" style bindings, focused surface first, then global.
- Layout: `defaultLayout`, `loadLayout`, `saveLayout`, `place`, `move`, `remove`.
- Clock: `realClock`, `ManualClock` (inject in tests), `tween`.
- `SurfaceHost`: iframes with `sandbox="allow-scripts"` only. `applyTheme`.
- `@endue-ai/runtime/desk.css`: the desk stylesheet.

## Testing

```bash
pnpm exec vitest run packages/runtime                        # unit
pnpm --filter @endue-ai/runtime exec playwright install webkit   # once
just test-e2e                                                # Playwright on the browser stub
```

`e2e/` uses fixture pages with the browser bridge stub and a manual clock (`plugins.html` adds two UI
plugins served by the fixture's Vite config). Render snapshots are
serialised render trees (ADR 0011); update them with
`pnpm --filter @endue-ai/runtime exec playwright test --update-snapshots` and review the JSON diff.
