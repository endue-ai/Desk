# Writing a Desk plugin

English · [日本語](../i18n/ja/plugins/authoring.md) · [中文](../i18n/zh/plugins/authoring.md) ·
[Français](../i18n/fr/plugins/authoring.md) · [Deutsch](../i18n/de/plugins/authoring.md) ·
[한국어](../i18n/ko/plugins/authoring.md)

A Desk plugin is a folder. Built-in features use exactly the same format, so anything Desk itself does
on screen, your plugin can do too. This page covers UI plugins (v0) and themes; logic (Wasm) and tool
(MCP) plugins come later.

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

A surface nobody has seen for a while (behind other windows, off the screen) may be unloaded to save
memory, and it loads again when it shows (ADR 0070). To come back as it was, register what to keep:
`surface.onUnload(() => ({ open, caret, scroll }))` answers the desk's `ui.surface.state` with JSON up
to 64 KiB, and the reloaded page finds it in `surface.restored`. Without a provider it comes back cold;
`state` above still comes back.

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

## Making a theme

A theme is a plugin of kind `theme`: the design system's values and the font and image files they name,
no code, so it asks for no permission (ADR 0056, ADR 0057). Start from the template or the example:

```bash
pnpm --filter @endue-ai/create-plugin build                       # once
node packages/create-plugin/dist/create-plugin.js ../my-theme --kind theme
DESK_DEV_PLUGINS=$PWD/../my-theme just dev
cargo run -p desk-cli -- theme apply local.my-theme
```

Once the package is published this is `pnpm create @endue-ai/plugin my-theme --kind theme`. The template
has every role colour for both schemes, every other layer at its default, and a README that says what
each one paints; `examples/plugin-hello-theme` is the smallest theme with a font and a backdrop.
Installing a theme does not apply it: the setting `desk.theme.active` names the one in force, chosen in
the theme studio (the palette button at the top right, or Themes in the command palette), with
`desk.theme.use` or with `desk theme apply`.

The studio makes themes too: "Tune a copy" (or `desk.theme.edit`) opens its editor on a copy of the
selected theme, "New theme" on the endue theme. Every layer has its controls, fonts and backdrop images
included; the whole desk shows the draft as it changes, the gate's fixes are listed under the palette,
and Save keeps it as your own theme (`local.<name>`). A folder is how a theme lives in a repository, is
tested, and is published.

### The block

`plugin.json` has kind `theme` and a `theme` block (`specs/plugin/v0/theme.schema.json`), and no
`entry`, `permissions`, `surfaces`, `contributes` or `autoload`:

```json
{
  "id": "example.dusk",
  "name": "Dusk",
  "version": "0.1.0",
  "kind": "theme",
  "theme": {
    "license": "Apache-2.0 AND OFL-1.1",
    "type": {
      "sans": "\"Space Grotesk\", system-ui, sans-serif",
      "fonts": [{ "family": "Space Grotesk", "src": "fonts/space-grotesk.woff2", "weight": "300 700" }]
    },
    "shape": { "radius": "round" },
    "dark": {
      "colors": { "background": "#1a1412", "text": "#f6ede6", "primary": "#ff9a62", "primaryForeground": "#2a1206" },
      "backdrop": { "gradient": ["#2e1c15", "#1a1412"], "glow": "rgba(255, 140, 80, 0.12)" }
    }
  }
}
```

`author`, `license` (an SPDX expression for the theme and its files), `tags`, `preview` (up to five
colours for its gallery card) and `origin` (the sentence and the theme it started from) describe it.
`light` and `dark` hold one scheme each. A theme needs one of them; the desk's own theme stands in for
the other.

### Layers and presets

Six layers, each with a default, so a palette alone is a theme:

| Layer | Key | Values |
| --- | --- | --- |
| Palette | `<scheme>.colors` | Token name (camelCase) to a CSS colour: the roles in `docs/design-system.md`, the shell's and Eris's tokens. A role left out keeps the desk's |
| Material | `<scheme>.material` | `opacity` 0.6–1, `blur` 0–24 px, `noise` 0–0.15, `border` 0–2 px, `shadow` none, soft or strong |
| Type | `type` | `sans` and `mono` font stacks, `scale` 0.85–1.25, `tracking` −0.02–0.05 em, `fonts` |
| Shape | `shape` | `radius` none, subtle, soft or round; `density` compact, comfortable or spacious |
| Motion | `motion` | `personality` snappy, smooth or calm |
| Backdrop | `<scheme>.backdrop` | A `color`, a `gradient` of two to four colours at an `angle`, or an `image` with `fit` cover or tile; a `glow` |

`<scheme>.terminal.ansi` gives the terminal its sixteen colours and `<scheme>.contrast` the palette's
changes under high contrast. Radius, density, motion, type scale and shadow are presets: the runtime
turns each name into tokens (`docs/design-system.md`, "Choosing a theme"), so a theme keeps working when
the desk retunes them. Numbers are bounded and values carry no `url()`, so any valid theme stays usable.

### The gate

The desk gates every theme it applies (`@endue-ai/ui/theme`): text reaches 4.5:1 on its ground, borders
and fills 3:1, and under high contrast 7:1 and 4.5:1. A foreground that falls short moves only its OKLCH
lightness, as little as reaches the ratio; a ground never changes. Without a `contrast` palette a theme's
high contrast is derived the same way from its own colours. Check your pairs in both schemes, so the
gate has nothing to fix.

### Assets and limits

Fonts are `.woff2` files and images `.png`, `.jpg` or `.webp` (no SVG, which can carry script), inside
the folder: 2 MiB each and 8 MiB together. Name a font's licence in `license` and keep its licence file
beside it; the built-in themes keep `fonts/OFL.txt` and a `fonts/SOURCE.md` with the upstream and the
checksums. The desk loads a theme's fonts as `FontFace` in the shell and in every plugin frame; only the
shell draws the backdrop.

### Testing a theme

```bash
cargo run -p desk-cli -- plugin validate ../my-theme
pnpm exec vitest run --root ../my-theme
```

`desk plugin validate` checks the block against the schema and the files against their limits. The
template's `tests/theme.test.ts` compiles both schemes with `compileTheme` and gates them over the endue
palette with `gate`, as the desk does before it applies a theme, and fails with every fix the gate
would make.

### Sharing as `.desk-theme`

```bash
cargo run -p desk-cli -- theme export local.my-theme     # local.my-theme.desk-theme in Downloads
cargo run -p desk-cli -- theme import ~/Downloads/dusk.desk-theme
```

A `.desk-theme` is one JSON file: `format` `desk-theme/1`, the theme's `plugin.json` as `manifest`, and
the files its block names in `files`, base64, 16 MiB at most (ADR 0058). Importing one checks it as a
theme plugin and installs it in the person's themes folder, where an id outside `local.` and `market.`
becomes `local.<its name>`; `desk theme list` shows it and `desk theme remove` deletes it. The studio's
Export and Import do the same, and it takes a `.desk-theme` dropped on it.

### The market

The studio's Market tab lists the themes of the markets that the setting `desk.theme.markets` names, by
the https URL of each index (ADR 0060). The default is this repository's `market/themes/index.json` on
`main`, read from `https://raw.githubusercontent.com/endue-ai/Desk/main/market/themes/index.json`. Add
another market's index after it in `init.yaml`; when two markets list the same id, the first one wins:

```yaml
settings:
  desk.theme.markets:
    - https://raw.githubusercontent.com/endue-ai/Desk/main/market/themes/index.json
    - https://themes.example.com/index.json
```

Each card shows a theme's preview colours, name, author and licence, and where it stands on this desk:
Available, Installed, Update available or Edited. Preview downloads the `.desk-theme`, checks its
sha256 and shows it on the whole desk without installing it. Install brings it in through
`theme.import` with its URL and sha256, under its id inside `market.`, and Apply puts it in force. An
update replaces a market theme only while you have not changed it; a theme you changed stays yours.

To publish a theme, open a pull request that adds its bundle and its index entry to `market/themes/`:

1. Export the theme (`desk theme export <id> <file>`, or Export in the studio) with an id inside
   `market.`, a version, `theme.author` and `theme.license`: an SPDX expression that covers its fonts
   and images too.
2. Put the file in `market/themes/` as `<name>.desk-theme` and add its entry to `index.json`
   (`specs/plugin/v0/theme-index.schema.json`): `id`, `name`, `version`, `description`, `author`,
   `license`, `tags`, up to five `preview` colours, `url` (the file name), `sha256` and `size`.
3. Run `node scripts/theme-market.mjs`. The market checker, part of `just check`, refuses a wrong hash
   or size, a missing licence, a duplicate id and a bundle that is not a valid theme plugin; a test
   gates every market theme in both schemes.

An update is a new version with its new bundle, sha256 and size. `market/themes/README.md` has the
same steps.
