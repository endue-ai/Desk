# @endue-ai/plugin-sdk

Everything a plugin author imports: plugin definitions, the bridge client and a test harness.

Layer: Plugins (see `docs/architecture.md`). Guide: `docs/plugins/authoring.md`.

## Public API

- `defineUiPlugin({ mount(ctx) })`: connect to the runtime, then mount. `ctx` has `pluginId`,
  `bridge` (`call`, `onEvent`), `state` (`get`, `set`; kept across reloads), `surface` (`close()` for
  the session, `show()` and `hide()` for a `hidden` surface), `commands` and `theme`.
- `ctx.commands`: `on(name, handler)` answers a command (what the handler returns, or resolves to, is
  the answer; commands that arrive before `mount` finishes wait for it); `run(name, args)` runs any
  command the desk has, as keys and the palette do; `list()` lists them with their keys. A failure is a
  `CommandFailed` with a `code` (`unknown_command`, `failed`, `cancelled`). ADR 0017.
- `ctx.theme`: `get()` and `on(listener)`; the frame also gets the tokens as `--desk-*` properties and
  `data-scheme`, `data-contrast` and `data-motion` on its root.
- Chords pressed in the frame (Meta, Control or Alt, and Escape) reach the desk's keymap unless the
  plugin called `preventDefault()` (`isDeskKey`).
- `connect(transport?)`, `windowTransport()`, the protocol types, `BridgeCallError` and bridge types.
- `@endue-ai/plugin-sdk/testing`: `createTestHost({ pluginId, state?, handlers?, commands? })`:
  `transport`, `calls`, `batches`, `state`, `closed`, `visible`, `ran`, `keys`, `emit`, `command`,
  `theme`, `settle`.

Calls made in one tick leave in one message. The app serves the bundle (`pnpm --filter
@endue-ai/plugin-sdk build`, output `dist/plugin-sdk.js`) at `/_desk/plugin-sdk.js`.

## Testing

```bash
pnpm exec vitest run packages/plugin-sdk
```
