# @endue-ai/plugin-sdk

Everything a plugin author imports: plugin definitions, the bridge client and a test harness.

Layer: Plugins (see `docs/architecture.md`). Guide: `docs/plugins/authoring.md`.

## Public API

- `defineUiPlugin({ mount(ctx) })`: connect to the runtime, then mount. `ctx` has `pluginId`,
  `bridge` (`call`, `onEvent`) and `state` (`get`, `set`; kept by the runtime across reloads).
- `connect(transport?)`: the same without `mount`.
- `windowTransport()`: the frame transport (parent `postMessage`); `Transport`, `PluginMessage`,
  `HostMessage` describe the protocol.
- `BridgeCallError` and the bridge types, re-exported from `@endue-ai/bridge`.
- `@endue-ai/plugin-sdk/testing`: `createTestHost({ pluginId, state?, handlers? })` runs a plugin
  over memory against a mock bridge; `transport`, `calls`, `batches`, `state`, `emit`, `settle`.

Calls made in one tick leave in one message. The app serves the bundle (`pnpm --filter
@endue-ai/plugin-sdk build`, output `dist/plugin-sdk.js`) at `/_desk/plugin-sdk.js`.

## Testing

```bash
pnpm exec vitest run packages/plugin-sdk
```
