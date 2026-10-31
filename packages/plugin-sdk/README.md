# @endue-ai/plugin-sdk

Everything a plugin author imports: plugin definitions, the bridge client and a test harness.

Layer: Plugins (see `docs/architecture.md`). Guide: `docs/plugins/authoring.md`.

## Public API

- `defineUiPlugin({ mount(ctx) })`: connect to the runtime, then mount. `ctx` has `pluginId`,
  `bridge` (`call`, `onEvent`), `state` (`get`, `set`; kept across reloads), `surface`, `commands`,
  `theme`, `settings`, `log`, `events`, `perm`, `data` and `views`, typed from `@endue-ai/bridge`.
- `ctx.data` (`data.*`, ADR 0032): `query(query, { scope? })` resolves the page, under the narrowest
  `data:read` scope (`readScope`: its kinds and the connectors of its sources); `get(source, id)` the
  item or undefined; `subscribe(query, listener)` the function that unsubscribes, once. `ctx.views`
  (`view.*`, needs `view:manage`): `list()`, `get(id)`, `save(view)`, `remove(id)`.
- `ctx.surface`: `open(id, { placement?, title? })` resolves a handle for `close(handle)`
  (`ui.surface.*`, needs `ui:surface`); `close()` ends this frame's own, `show()`/`hide()` a `hidden` one.
- `ctx.settings` (the plugin's own keys, `settings.*`): `get(key)`, `set(key, value)`, `list()`,
  `onChange(listener)`. `ctx.log`: `write(level, message, fields?)`, `tail({ channel?, count? })`
  (needs `log:read`). `ctx.events.subscribe(names, listener)` resolves the function that unsubscribes
  (needs `events:subscribe`). `ctx.perm`: `request(permission, reason, duration?)`, `query(permission?)`.
- `ctx.commands` (bridge `cmd.*`, ADR 0017): `run(id, args)` is `cmd.invoke` and resolves with the
  provider's `cmd.answered` (needs a `cmd:invoke` grant covering the id); `list()` is `cmd.list`;
  `on(name, handler)` answers this plugin's commands (`cmd.invoked`) and the desk's requests by name,
  after `mount`. A failure is a `CommandFailed` (`unknown_command`, `failed`, `cancelled`).
- `ctx.theme`: `get()`, `on(listener)`; the frame gets `--desk-*` properties and `data-scheme`,
  `-contrast`, `-motion`. Chords (Meta, Control, Alt, Escape) reach the desk unless prevented.
- `connect(transport?)`, `windowTransport()`, the protocol types, `BridgeCallError` and bridge types.
- `@endue-ai/plugin-sdk/testing`: `createTestHost({ pluginId, state?, handlers?, commands?, settings?,
  grants?, callers?, prompt?, now?, refuse? })` runs a plugin on the bridge's stub of the core
  (`stubCommands`; `handlers` override it, `refuse` fails a method): `transport`, `calls`, `batches`,
  `state`, `closed`, `visible`, `ran`, `keys`, `settings`, `grants`, `logged`, `surfaces`, `call` (as
  the desk or another caller), `emit`, `command`, `invoke`, `theme`, `upsert`, `remove`, `settle`.

Calls made in one tick leave in one message. The app serves the bundle (`pnpm --filter
@endue-ai/plugin-sdk build`, output `dist/plugin-sdk.js`) at `/_desk/plugin-sdk.js`.

## Testing

`pnpm exec vitest run packages/plugin-sdk`
