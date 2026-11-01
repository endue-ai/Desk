# @endue-ai/plugin-sdk

What a plugin imports: definitions, the bridge client, file reads, workers and a test harness.
Layer: Plugins (`docs/architecture.md`). Guide: `docs/plugins/authoring.md`.

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
- `ctx.theme`: `get()`, `on(listener)`; the frame gets `--desk-*`, `data-scheme`, `-contrast` and
  `-motion`. Chords (Meta, Control, Alt, Escape) reach the desk unless prevented.
- `readBytes(ctx, { path, scope }, { onProgress?(done, total), signal? })`: the file as a `Uint8Array`,
  in 2 MiB `Range` requests to its `fs.url` URL (else `fs.read` ranges); `signal` rejects (`AbortError`).
  `byteSource(ctx, file)`: `{ size, read(offset, length) }`, cached. `startWorker(url)`: a module worker.
- `connect(transport?)`, `windowTransport()`, the protocol types, `BridgeCallError` and bridge types;
  one tick's calls leave in one message. The app serves `dist/plugin-sdk.js` at `/_desk/plugin-sdk.js`.
- `@endue-ai/plugin-sdk/testing`: `createTestHost({ pluginId, state?, handlers?, commands?, settings?,
  grants?, callers?, prompt?, now?, refuse?, files? })` runs a plugin on the bridge's stub of the core
  (`handlers` override it, `refuse` fails a method, `files` back `fs.read` and `fs.url`): `transport`,
  `calls`, `batches`, `state`, `closed`, `visible`, `ran`, `keys`, `settings`, `grants`, `logged`,
  `surfaces`, `call` (as any caller), `emit`, `command`, `invoke`, `theme`, `upsert`, `remove`, `settle`.

## Testing

`pnpm exec vitest run packages/plugin-sdk`
