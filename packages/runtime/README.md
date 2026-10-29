# @endue-ai/runtime

The desk in the webview: the 2D compositor and plugin host, and the shell UI around them (modes,
desktops, the left bar, Eris, the status rail, the bottom edge, surfaces). Plain TypeScript and DOM
(ADR 0010); every animation runs on an injected clock (ADR 0013).

## Public API

- `mountDesk({ root, bridge, clock?, lang?, modes?, persist?, reducedMotion?, platform?, epoch? })`
  mounts the shell in two layers (system layer, ADR 0019; mode layer) and returns
  `{ store, ticker, eris, keys, ready, refresh, dispose }`. Styles: `src/shell/styles.ts`;
  tokens: `@endue-ai/runtime/tokens.css` (the only file with literal colours).
- `ShellBridge` (`storage`, `perm`, `audio`, `brain`, and the agent directory `agents`, `spaces`,
  `a2a` of specs/brain/v0, ADR 0020); `browserBridge({ now, storage?, grant?, epoch? })` is the stub.
- System: `system/commands.ts` (every command, also the palette), `system/keys.ts` (`Keymap`: defaults,
  rebinding, saved overrides), `surface/tree.ts` (panes: split, close, resize).
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
pnpm exec vitest run packages/runtime    # unit: mesh, voice, soul, modes, tokens
just test-e2e                            # Playwright on the browser stub (macOS: Linux container)
```

Snapshots are render trees (ADR 0011) at fixed clock times; the Eris canvas adds a frame digest and
its ring profile. Update with `just test-e2e --update-snapshots` and review the JSON diff. Playwright
never runs directly: the configs refuse native WebKit on macOS (ADR 0018). Shell fixture:
`e2e/fixture/shell.html` (`?lang=en`, `?persist=1`, `?reduced=1`). Shell decisions not in the brief:
`ASSUMPTIONS.md`.
