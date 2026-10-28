# @endue-ai/runtime

The desk in the webview: the 2D compositor and plugin host, and the shell UI around them (modes,
desktops, the left bar, Eris, the status rail, the bottom edge, surfaces). Plain TypeScript and DOM
(ADR 0010); every animation runs on an injected clock (ADR 0013).

## Public API

- `mountDesk({ root, bridge, clock?, lang?, modes?, persist?, reducedMotion? })` mounts the shell and
  returns `{ store, ticker, eris: { say, setState }, ready, dispose }`. Styles: `src/shell/styles.ts`;
  tokens: `@endue-ai/runtime/tokens.css` (the only file with literal colours).
- `ShellBridge` (`storage.get/set`, `perm.request`, `audio.levels()`, `brain.status/use/say`) and
  `browserBridge({ now, storage?, grant? })`, the stub with fake audio envelopes (`fake.play`).
- Eris: `eris/mesh.ts` (deterministic mesh, three densities), `eris/voice.ts` (nine bands → nine rings),
  `eris/soul.ts` (soul text timing). Modes: folders in `src/modes/sample/`, layering in `modes/model.ts`.
- Compositor: `createRuntime`, `PluginHost` (ADR 0012, 0014), `ShortcutRouter`, layout helpers,
  `realClock`, `ManualClock`, `tween`, `SurfaceHost`, `applyTheme`, `@endue-ai/runtime/desk.css`.

## Run

```bash
pnpm dev        # the shell on the browser stub at http://127.0.0.1:5173 (Shift+U / Shift+E: sound rings)
```

## Testing

```bash
pnpm exec vitest run packages/runtime                          # unit: mesh, voice, soul, modes, tokens
pnpm --filter @endue-ai/runtime exec playwright install webkit # once
just test-e2e                                                  # Playwright on the browser stub
```

Snapshots are render trees (ADR 0011) at fixed clock times; the Eris canvas adds a frame digest and
its ring profile. Update with `pnpm --filter @endue-ai/runtime exec playwright test --update-snapshots`
and review the JSON diff. Shell fixture: `e2e/fixture/shell.html` (`?lang=en`, `?persist=1`, `?reduced=1`).
Shell decisions not in the brief: `ASSUMPTIONS.md`.
