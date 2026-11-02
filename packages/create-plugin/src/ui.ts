// The files of a new UI plugin, in the same layout as examples/plugin-hello-ui: the page, its
// entry script, the plugin it mounts (apart from the SDK, so its test can run it) and that test.

import type { PluginManifest } from "@endue-ai/bridge";
import { checkSection, devSection, heading } from "./readme";
import type { PluginOptions } from "./template";

/** Every file of the UI plugin's folder, keyed by its path relative to the folder. */
export function renderUi(options: PluginOptions): Record<string, string> {
  return {
    "plugin.json": manifest(options),
    "README.md": readme(options),
    "ui/index.html": indexHtml(options),
    "ui/main.js": MAIN_JS,
    "ui/plugin.js": PLUGIN_JS,
    "ui/style.css": STYLE_CSS,
    "tests/plugin.test.js": PLUGIN_TEST,
  };
}

function manifest({ id, name, description }: PluginOptions): string {
  const value: PluginManifest = {
    id,
    name,
    version: "0.1.0",
    kind: "ui",
    entry: "ui/index.html",
    ...(description === undefined ? {} : { description }),
    surfaces: [{ id: "main", title: name, placement: "center" }],
    contributes: { commands: [{ id: `${id}.count`, title: `${name}: count` }] },
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readme(options: PluginOptions): string {
  return [
    ...heading(options, "A Desk UI plugin."),
    ...devSection(
      [
        "Save any file here and only this surface reloads, within a second. The count stays, because it",
        `lives in plugin state rather than in the page. \`desk cmd run ${options.id}.count\` counts too.`,
      ].join("\n"),
    ),
    "## Permissions",
    "",
    "None yet. Declare each one in `plugin.json` `permissions`, ask for it when you need it",
    '(`bridge.call("perm.request", { permission, reason })`), and say here why the plugin asks.',
    "",
    "## Files",
    "",
    "| File | Purpose |",
    "| --- | --- |",
    "| `plugin.json` | The manifest (specs/plugin v0): id, version, kind `ui`, entry, one surface, one command |",
    "| `ui/index.html` | The entry page; its import map points `@endue-ai/plugin-sdk` and `@endue-ai/ui` at `/_desk/` |",
    "| `ui/main.js` | `defineUiPlugin(plugin)`: connects the plugin to the desk |",
    "| `ui/plugin.js` | The plugin's `mount`: state, a button, a command, a bridge call |",
    "| `ui/style.css` | The page's own layout, on the desk's tokens |",
    "| `tests/plugin.test.js` | Its test, on the SDK's test host |",
    "",
    ...checkSection(
      [
        "`plugin test` runs `tests/*.test.js` with vitest on the SDK's test host: a desk in memory that",
        "answers the bridge, in a jsdom page. `ui/plugin.js` imports nothing from the SDK, so the test",
        "imports it as it is.",
      ].join("\n"),
    ),
  ].join("\n");
}

function indexHtml({ name }: PluginOptions): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(name)}</title>
    <!-- Desk serves these under /_desk/: the design tokens and the base sheet for plugin pages, the SDK
         and the elements (docs/design-system.md). The import map lets plugins import the two by name. -->
    <link rel="stylesheet" href="/_desk/tokens.css" />
    <link rel="stylesheet" href="/_desk/base.css" />
    <script type="importmap">
      { "imports": { "@endue-ai/plugin-sdk": "/_desk/plugin-sdk.js", "@endue-ai/ui": "/_desk/ui.js" } }
    </script>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <h1>${escapeHtml(name)}</h1>
    <p data-testid="bridge">bridge: waiting</p>
    <p>
      <desk-button variant="primary">Count</desk-button>
      <span data-testid="count">0</span>
    </p>
    <script type="module" src="./main.js"></script>
  </body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const MAIN_JS = `// The page's entry: it connects the plugin to the desk. Desk serves the SDK and the elements under
// /_desk/, and the page's import map lets this file import them by name.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
// The elements define themselves on import; the page uses <desk-button>.
import "@endue-ai/ui";
import { plugin } from "./plugin.js";

defineUiPlugin(plugin);
`;

const PLUGIN_JS = `// The plugin: what it does once the desk mounts it. It imports nothing from the SDK, so its test
// runs it on the SDK's test host. While Desk runs this folder as a dev plugin, saving a file reloads
// only this surface, and the count comes back because it lives in plugin state, not in the page.
export const plugin = {
  async mount(ctx) {
    const count = document.querySelector("[data-testid=count]");
    let value = ctx.state.get()?.count ?? 0;
    count.textContent = String(value);
    const add = () => {
      value += 1;
      ctx.state.set({ count: value });
      count.textContent = String(value);
      return value;
    };
    document.querySelector("desk-button").addEventListener("click", add);
    // The command plugin.json contributes: the palette lists it, and keys and \`desk cmd run\` run it.
    ctx.commands.on(\`\${ctx.pluginId}.count\`, add);

    // perm.query needs no permission, so this round trip works before you declare any.
    const { grants } = await ctx.bridge.call("perm.query", {});
    document.querySelector("[data-testid=bridge]").textContent =
      \`bridge: ok, \${grants.length} grants\`;
  },
};
`;

const STYLE_CSS = `/* The page's own layout. Colours, type and spacing come from the desk's tokens (/_desk/tokens.css)
   over the base sheet (/_desk/base.css), so the theme in force restyles this page too. */
body {
  padding: var(--desk-space-3);
}

h1 {
  margin: 0 0 var(--desk-space-2);
  font-size: var(--desk-text-base);
}

p {
  margin: var(--desk-space-1) 0;
  color: var(--desk-text-muted);
}
`;

const PLUGIN_TEST = `// The plugin on the SDK's test host: a desk in memory that answers the bridge, no app or browser.
// \`desk plugin test <this folder>\` runs it with vitest, in a jsdom page.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createTestHost } from "@endue-ai/plugin-sdk/testing";
import { expect, it } from "vitest";
import { plugin } from "../ui/plugin.js";

// The plugin's own files, by their path in the folder.
const read = (path) => readFileSync(join(import.meta.dirname, "..", path), "utf8");
const manifest = JSON.parse(read("plugin.json"));

it("counts on a click and on its command, into plugin state", async () => {
  document.documentElement.innerHTML = read("ui/index.html");
  // A reload: the desk hands the plugin the state it saved.
  const host = createTestHost({ pluginId: manifest.id, state: { count: 2 } });
  // The desk registers the commands plugin.json contributes when it mounts the plugin.
  for (const { id, title } of manifest.contributes.commands) {
    await host.call("cmd.register", { id, title }, manifest.id);
  }
  await defineUiPlugin(plugin, host.transport);
  await host.settle();

  const count = document.querySelector("[data-testid=count]");
  expect(count.textContent).toBe("2");
  document.querySelector("desk-button").click();
  expect(count.textContent).toBe("3");
  expect(await host.invoke(\`\${manifest.id}.count\`)).toBe(4);
  expect(host.state).toEqual({ count: 4 });
  expect(document.querySelector("[data-testid=bridge]").textContent).toBe("bridge: ok, 0 grants");
});
`;
