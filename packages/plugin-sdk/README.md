# @endue-ai/plugin-sdk

Everything a plugin author imports: plugin definitions, the bridge client and a test harness.

Layer: Plugins (see `docs/architecture.md`). Guide: `docs/plugins/authoring.md`.

## Public API

- `defineUiPlugin({ mount(ctx) })`: connect to the runtime, then mount. `ctx` has `pluginId`,
  `bridge` (`call`, `onEvent`), `state` (`get`, `set`; kept across reloads), `surface` (`close()` for
  the session, `show()` and `hide()` for a `hidden` surface), `commands` and `theme`.
- `ctx.commands`, over the core's registry (bridge `cmd.*`, ADR 0017): `run(id, args)` is `cmd.invoke`
  and resolves with the provider's `cmd.answered` (it needs a `cmd:invoke` grant covering the id);
  `list()` is `cmd.list`; `on(name, handler)` answers this plugin's commands as `cmd.invoked` arrives
  (with `cmd.answer`) and the desk's requests by name (`desk.files.visit`, ...). What the handler returns
  is the answer; anything that arrives before `mount` finishes waits for it. A failure is a
  `CommandFailed` with a `code` (`unknown_command`, `failed`, `cancelled`).
- `ctx.theme`: `get()` and `on(listener)`; the frame also gets the tokens as `--desk-*` properties and
  `data-scheme`, `data-contrast` and `data-motion` on its root.
- Chords pressed in the frame (Meta, Control or Alt, and Escape) reach the desk's keymap unless the
  plugin called `preventDefault()` (`isDeskKey`).
- `connect(transport?)`, `windowTransport()`, the protocol types, `BridgeCallError` and bridge types.
- `@endue-ai/plugin-sdk/testing`: `createTestHost({ pluginId, state?, handlers?, commands? })` runs a
  plugin against a mock bridge with the core's registry (`commands` are the desk's): `transport`,
  `calls`, `batches`, `state`, `closed`, `visible`, `ran`, `keys`, `emit`, `command`, `invoke`, `theme`,
  `settle`.

Calls made in one tick leave in one message. The app serves the bundle (`pnpm --filter
@endue-ai/plugin-sdk build`, output `dist/plugin-sdk.js`) at `/_desk/plugin-sdk.js`.

## Testing

```bash
pnpm exec vitest run packages/plugin-sdk
```
