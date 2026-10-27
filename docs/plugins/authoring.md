# Writing a Desk plugin

English · [日本語](../i18n/ja/plugins/authoring.md) · [中文](../i18n/zh/plugins/authoring.md) ·
[Français](../i18n/fr/plugins/authoring.md) · [Deutsch](../i18n/de/plugins/authoring.md) ·
[한국어](../i18n/ko/plugins/authoring.md)

A Desk plugin is a folder. Built-in features use exactly the same format, so anything Desk itself does
on screen, your plugin can do too. This page covers UI plugins (v0); logic (Wasm) and tool (MCP)
plugins come later.

## Start from the example

```bash
cp -R examples/plugin-hello-ui ../my-plugin      # then change the id in plugin.json
cargo run -p desk-cli -- plugin validate ../my-plugin
```

To see a plugin on the desk while you work on it, run Desk with your folder as a dev plugin:

```bash
DESK_DEV_PLUGINS=$PWD/../my-plugin just dev
```

Save any file in the folder and only your plugin's surface reloads, within a second. The rest of the
desk, and your plugin's state, stay where they were.

## The folder

| Path | Required | Purpose |
| --- | --- | --- |
| `plugin.json` | yes | The manifest: id, version, kind, entry, permissions, surfaces |
| `ui/index.html` | yes (the `entry`) | The page Desk loads into a sandboxed frame |
| `ui/*.js`, `ui/*.css` | no | Your code and styles, loaded relative to the entry |
| `README.md` | recommended | What the plugin does and which permissions it asks for, and why |

The manifest follows `specs/plugin/v0/plugin.schema.json`:

```json
{
  "id": "example.my-plugin",
  "version": "0.1.0",
  "kind": "ui",
  "entry": "ui/index.html",
  "permissions": [{ "permission": "fs:read", "paths": ["~/Documents/**"] }],
  "surfaces": [{ "id": "main", "title": "My plugin", "placement": "center" }]
}
```

Ids are lowercase and reverse-domain (`example.my-plugin`). The entry stays inside the folder.

## The SDK

Import the SDK through an import map in your entry page; Desk serves it at `/_desk/plugin-sdk.js`:

```html
<script type="importmap">
  { "imports": { "@endue-ai/plugin-sdk": "/_desk/plugin-sdk.js" } }
</script>
<script type="module" src="./main.js"></script>
```

```js
import { defineUiPlugin } from "@endue-ai/plugin-sdk";

defineUiPlugin({
  async mount({ pluginId, bridge, state }) {
    const saved = state.get() ?? { count: 0 };   // survives reloads of this surface
    state.set({ count: saved.count + 1 });
    const { grants } = await bridge.call("perm.query", {});
    bridge.onEvent((event) => console.log(event.event));
  },
});
```

`bridge.call(method, params)` reaches the core. Calls made in the same tick travel together in one
message. A refused call rejects with a `BridgeCallError` whose `code` is, for example,
`permission_denied`.

## Permissions

Your frame runs sandboxed with scripts only: no access to the desk's page, no top-level navigation, no
forms or popups, and no network connections of its own. Every capability goes through the bridge, and
every bridge call except `perm.*` carries the permission scope it needs (`params.scope`). The core
answers only when the person has granted a permission that covers that scope.

1. Declare everything you may ask for in `plugin.json` `permissions`.
2. Ask at the moment you need it: `bridge.call("perm.request", { permission, reason })`.
3. Pass the matching scope with each call, as narrow as you can.

The vocabulary (`fs:read`, `fs:write`, `proc:spawn`, `net:fetch`, `audio:capture`, `ui:surface`,
`ui:notify`, `plugin:manage`) is in `specs/plugin/v0/README.md`.

## Testing

`@endue-ai/plugin-sdk/testing` runs your plugin without a browser, against a mock bridge:

```ts
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createTestHost } from "@endue-ai/plugin-sdk/testing";

const host = createTestHost({ pluginId: "example.my-plugin", handlers: { "perm.query": () => ({ grants: [] }) } });
await defineUiPlugin(myPlugin, host.transport);
await host.settle();
// host.calls, host.state, host.emit(event)
```

Before you publish, `desk plugin validate <folder>` must pass; CI runs it for every folder in
`plugins/` and `examples/`.
