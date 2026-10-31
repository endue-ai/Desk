// The files of a new UI plugin, in the same layout as examples/plugin-hello-ui; a connector's are
// in ./connector.

import type { PluginManifest } from "@endue-ai/bridge";
import { renderConnector } from "./connector";

/** What the folder holds: a UI plugin, or a Wasm connector in Rust. */
export type TemplateKind = "ui" | "connector";

export interface PluginOptions {
  /** Manifest id, already checked with `checkId`. */
  id: string;
  /** Display name, shown as the surface title and the page heading. */
  name: string;
  /** One sentence about what the plugin does; left out of the manifest when absent. */
  description?: string;
  /** `ui` when absent. */
  kind?: TemplateKind;
}

/** Every file of the plugin folder, keyed by its path relative to the folder. */
export function renderPlugin(options: PluginOptions): Record<string, string> {
  if (options.kind === "connector") return renderConnector(options);
  return {
    "plugin.json": manifest(options),
    "README.md": readme(options),
    "ui/index.html": indexHtml(options),
    "ui/main.js": MAIN_JS,
    "ui/style.css": STYLE_CSS,
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
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}

const FENCE = "```";

function readme({ id, name, description }: PluginOptions): string {
  return [
    `# ${name}`,
    "",
    description ?? "A Desk UI plugin.",
    "",
    `Id: \`${id}\`. Ids are lowercase and reverse-domain; use a domain you own before you publish.`,
    "",
    "## Run it",
    "",
    "From the Desk repository, run Desk with this folder as a dev plugin:",
    "",
    `${FENCE}bash`,
    "DESK_DEV_PLUGINS=/path/to/this/folder just dev",
    FENCE,
    "",
    "Save any file here and only this surface reloads, within a second. The count stays, because it",
    "lives in plugin state rather than in the page.",
    "",
    "## Permissions",
    "",
    "None yet. Declare each one in `plugin.json` `permissions`, ask for it when you need it",
    '(`bridge.call("perm.request", { permission, reason })`), and say here why the plugin asks.',
    "",
    "## Files",
    "",
    "| File | Purpose |",
    "| --- | --- |",
    "| `plugin.json` | The manifest (specs/plugin v0): id, version, kind `ui`, entry, one surface |",
    "| `ui/index.html` | The entry page; its import map points `@endue-ai/plugin-sdk` at `/_desk/plugin-sdk.js` |",
    "| `ui/main.js` | `defineUiPlugin({ mount })`: state, a button, a bridge call |",
    "| `ui/style.css` | The plugin's own styles (plugins do not share the desk's CSS) |",
    "",
    "## Check it",
    "",
    `${FENCE}bash`,
    "cargo run -p desk-cli -- plugin validate /path/to/this/folder",
    FENCE,
    "",
    "Guide: `docs/plugins/authoring.md` in the Desk repository.",
    "",
  ].join("\n");
}

function indexHtml({ name }: PluginOptions): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(name)}</title>
    <!-- Desk serves the SDK at /_desk/plugin-sdk.js; the import map lets plugins import it by name. -->
    <script type="importmap">
      { "imports": { "@endue-ai/plugin-sdk": "/_desk/plugin-sdk.js" } }
    </script>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <h1>${escapeHtml(name)}</h1>
    <p data-testid="bridge">bridge: waiting</p>
    <p>
      <button type="button">Count</button>
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

const MAIN_JS = `// While Desk runs this folder as a dev plugin, saving a file reloads only this surface, and the
// count comes back because it lives in plugin state, not in the page.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";

defineUiPlugin({
  async mount({ bridge, state }) {
    const count = document.querySelector("[data-testid=count]");
    let value = state.get()?.count ?? 0;
    count.textContent = String(value);
    document.querySelector("button").addEventListener("click", () => {
      value += 1;
      state.set({ count: value });
      count.textContent = String(value);
    });

    // perm.query needs no permission, so this round trip works before you declare any.
    const { grants } = await bridge.call("perm.query", {});
    document.querySelector("[data-testid=bridge]").textContent =
      \`bridge: ok, \${grants.length} grants\`;
  },
});
`;

const STYLE_CSS = `/* Plugins run in their own sandboxed document, so they bring their own styles. */
body {
  margin: 0;
  padding: 12px;
  background: #1e1d21;
  color: #f2f0f5;
  font: 13px/1.5 -apple-system, "SUIT", "Inter", system-ui, sans-serif;
}

h1 {
  margin: 0 0 8px;
  font-size: 15px;
}

p {
  margin: 4px 0;
  color: #b0adb7;
}

button {
  padding: 2px 10px;
  color: #141416;
  background: #b6a3f5;
  border: 0;
  border-radius: 6px;
  font: inherit;
}
`;
