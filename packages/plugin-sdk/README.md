# @endue-ai/plugin-sdk

What a plugin imports. Layer: Plugins (`docs/architecture.md`). Guide: `docs/plugins/authoring.md`.

## Public API
- `defineUiPlugin({ mount(ctx) })`: connect to the runtime, then mount. `ctx` has `pluginId`, `bridge`
  (`call`, `onEvent`), `state` (`get`, `set`; kept across reloads), `surface`, `commands`, `theme`,
  `settings`, `log`, `events`, `perm`, `data`, `views` and `universal`, typed from `@endue-ai/bridge`.
- `ctx.universal` (ADR 0087): `parse(text)` reads universal data from YAML or JSON (`parseYaml`: the core
  schema, no anchors or tags); `load(source)` reads `data`, an `asset`, a `url` (`net.fetch`), a `file`
  (`fs.read`), a `command` or `items`; `open(host, view, { setup?, onError? })` draws
  `<desk-universal-view>`, reloads it (live for items, else every `refresh` s) and runs its actions,
  `move` and `send` (`fillArgs`); it answers `{ element, data, reload, close }`.
- `ctx.data` (`data.*`, ADR 0032): `query(query, { scope? })` the page under the narrowest `data:read`
  scope (`readScope`); `get(source, id)` the item or undefined; `subscribe(query, listener)` the function
  that unsubscribes. `ctx.views` (`view.*`, `view:manage`): `list()`, `get(id)`, `save(view)`, `remove(id)`.
- `ctx.surface`: `open(id, { placement?, title? })` a handle for `close(handle)` (`ui:surface`); `close()`
  ends this frame's, `show()`/`hide()` a `hidden` one; `onUnload(provider)`: JSON (64 KiB) kept when the
  desk unloads it unseen, back as `restored`. Chords (Meta, Control, Alt, Escape) reach the desk.
- `ctx.settings` (the plugin's own keys, `settings.*`): `get(key)`, `set(key, value)`, `list()`,
  `onChange(listener)`. `ctx.log`: `write(level, message, fields?)`, `tail({ channel?, count? })`
  (needs `log:read`). `ctx.events.subscribe(names, listener)` resolves the function that unsubscribes
  (needs `events:subscribe`). `ctx.perm`: `request(permission, reason, duration?)`, `query(permission?)`.
- `ctx.commands` (`cmd.*`, ADR 0017): `run(id, args)` is `cmd.invoke` and resolves with the provider's
  answer (needs `cmd:invoke` for the id); `list()`; `tools(query?)` (ADR 0088); `on(name, handler)`
  answers this plugin's commands and the desk's requests, after `mount`. Failures are `CommandFailed`
  (`unknown_command`, `failed`, `cancelled`). `ctx.search.replace(documents)`: 500 / 4 MiB; `[]` clears.
- `ctx.theme`: `get()`, `on(listener)` (`--desk-*`, `data-scheme`, `-contrast`, `-motion`). `readBytes(ctx,
  { path, scope }, { onProgress?, signal? })`: 2 MiB `Range` requests to `fs.url` (else `fs.read`);
  `byteSource(ctx, file)` (cached `read(offset, length)`), `startWorker(url)`, `fileHistory`, `restoreFile`.
- `connect(transport?)`, `windowTransport()`, protocol and bridge types, `BridgeCallError`; one tick's
  calls leave in one message; `desk:ready` or `desk:failed` (ADR 0061). Served at `/_desk/plugin-sdk.js`.
- `@endue-ai/plugin-sdk/testing`: `createTestHost({ pluginId, state?, restored?, handlers?, commands?,
  settings?, grants?, callers?, prompt?, now?, refuse?, files? })` runs a plugin on the stub core:
  `transport`, `calls`, `batches`, `state`, `closed`, `visible`, `ran`, `keys`, `settings`, `grants`,
  `logged`, `surfaces`, `call`, `emit`, `command`, `surfaceState`, `invoke`, `theme`, `upsert`, `remove`,
  `settle`. `assertRoundTrip(bytes, parse, serialize)`, `assertMinimalEdit(before, after, edit)` (ADR 0071).

## Testing
`pnpm exec vitest run packages/plugin-sdk`; `desk plugin test` runs plugins on `vitest.plugin.config.ts`.
