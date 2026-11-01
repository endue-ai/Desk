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
`ui:notify`, `plugin:manage`, `brain:converse`, `cmd:invoke`, `cmd:advise`, `settings:read`, `log:read`,
`events:subscribe`, `perm:manage`, `data:read`, `connector:manage`, `view:manage`) is in
`specs/plugin/v0/README.md`.

## Contributions

A plugin can add to the desk's default policies without code, in `plugin.json` `contributes` (ADR
0017): commands the palette lists and keys run, key bindings, display rules, the files it opens, themes,
settings with their defaults, and profiles. Commands, settings and themes start with your plugin id.

```json
"contributes": {
  "commands": [{ "id": "example.my-plugin.new", "title": "New note" }],
  "keys": [{ "key": "Mod+Shift+N", "command": "example.my-plugin.new" }],
  "display": [{ "match": { "plugin": "example.my-plugin" }, "area": "right", "size": { "pixels": 360 } }],
  "files": [{ "pattern": "*.md", "plugin": "example.my-plugin" }],
  "settings": { "example.my-plugin.folder": { "kind": "string", "default": "~/notes" } }
}
```

Answer your commands with `ctx.commands.on`, and run any command the desk has with `ctx.commands.run`.
Both go through the core's command registry (`cmd.*`); running a command you do not provide needs a
`cmd:invoke` permission covering its id, such as `{ "permission": "cmd:invoke", "ids": ["desk.theme.*"] }`:

```js
defineUiPlugin({
  mount(ctx) {
    ctx.commands.on("example.my-plugin.new", async () => "note-1");      // the answer
    ctx.commands.on("desk.files.visit", ({ buffer, path }) => { /* fs.read it, show it */ });
    ctx.commands.on("desk.files.save", ({ buffer, path }) => { /* fs.write it */ });
    document.querySelector("button").onclick = () => ctx.commands.run("desk.theme.toggle");
  },
});
```

A file opener answers `desk.files.visit`, `desk.files.save` and `desk.files.revert`, and marks unsaved
work with `desk.buffers.update { id, modified: true }`. The theme reaches your frame as `--desk-*` CSS
properties and `ctx.theme`. Key chords pressed in your frame reach the desk's keymap unless you call
`preventDefault()`. The defaults, and what each one decides, are listed in `plugins/README.md`.

## Items and views

What the apps a person connects hold reaches the desk as items of one shape (`specs/item/v0`, ADR
0032): events, tasks, messages, notes and more, from every source alike. `ctx.data` reads the desk's
index under a `data:read` permission and passes the narrowest scope a query needs; `ctx.views` reads
and saves the person's views under `view:manage`:

```js
const { items } = await ctx.data.query({
  kinds: ["task"],
  where: [{ field: "due", op: "lt", value: "2026-10-31T00:00:00+09:00" }],
});
const stop = await ctx.data.subscribe({ kinds: ["task"] }, (changes) => redraw(changes));
await ctx.commands.run("desk.views.open", { id: "desk.today" });
```

A view is data, not code (`specs/view/v0`): the built-in `desk.views` draws it with the
`@endue-ai/ui` elements (`desk-list`, `desk-table`, `desk-agenda`, `desk-stat`, `desk-markdown`,
`desk-card`), and its templates know the clock (`{today}`, `{tomorrow}`). Your page can import the
same elements (`"@endue-ai/ui": "/_desk/ui.js"` in its import map) once the app serves them; the
runtime's test server does today.

## Testing

`@endue-ai/plugin-sdk/testing` runs your plugin without a browser, against a mock bridge:

```ts
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createTestHost } from "@endue-ai/plugin-sdk/testing";

const host = createTestHost({ pluginId: "example.my-plugin", handlers: { "perm.query": () => ({ grants: [] }) } });
await defineUiPlugin(myPlugin, host.transport);
await host.settle();
// host.calls, host.state, host.emit(event), host.upsert(item)
```

Before you publish, `desk plugin validate <folder>` must pass; CI runs it for every folder in
`plugins/` and `examples/`.
