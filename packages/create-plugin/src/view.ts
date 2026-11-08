// The files of a new view plugin: a universal view as data in plugin.json (specs/view/v0, ADR 0087,
// ADR 0103), a command that opens it, and a test. No code: the desk's built-in desk.universal draws
// it. Nothing here writes an item view (ADR 0032): those are read, never written, through v0.

import type { PluginManifest, UniversalView } from "@endue-ai/bridge";
import { checkSection, devSection, heading } from "./readme";
import type { PluginOptions } from "./template";

/** Every file of the view plugin's folder, keyed by its path relative to the folder. */
export function renderView(options: PluginOptions): Record<string, string> {
  return {
    "plugin.json": manifest(options),
    "README.md": readme(options),
    "tests/view.test.js": VIEW_TEST,
  };
}

function manifest({ id, name, description }: PluginOptions): string {
  const view: UniversalView = {
    id,
    title: name,
    description: "The notes touched last, newest first.",
    type: "list",
    types: ["list", "timeline"],
    source: {
      items: { kinds: ["note"], sort: [{ field: "updatedAt", dir: "desc" }], limit: 20 },
    },
    empty: "No notes yet.",
  };
  const value: PluginManifest = {
    id,
    name,
    version: "0.1.0",
    kind: "view",
    ...(description === undefined ? {} : { description }),
    view,
    contributes: {
      commands: [
        {
          id: `${id}.open`,
          title: `Open ${name}`,
          runs: { command: "desk.views.open", args: { id } },
        },
      ],
    },
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readme(options: PluginOptions): string {
  const open = `${options.id}.open`;
  return [
    ...heading(options, "A Desk view: the notes touched last, newest first."),
    ...devSection(
      [
        `Open it from the palette (Open ${options.name}) or with \`desk cmd run ${open}\`. It shows`,
        "the notes of every connected source. Save `plugin.json` and the view follows.",
      ].join("\n"),
    ),
    "## What it is",
    "",
    "A view is data, not code (`specs/view/v0/universal.schema.json`): `view` in `plugin.json` is a",
    "universal view, one presentation (`list`, `kanban`, `calendar`, `chart`, `stat`, ...) over a",
    "source, here the desk's notes. A page of them (`sections`) lays several out together.",
    `\`${open}\` is an alias: the desk runs \`desk.views.open\` with this view's id.`,
    "",
    "## Files",
    "",
    "| File | Purpose |",
    "| --- | --- |",
    "| `plugin.json` | The manifest (specs/plugin v0): kind `view`, the view inline, one command |",
    "| `tests/view.test.js` | Its test, on the SDK's test host |",
    "",
    ...checkSection(
      [
        "`plugin test` runs `tests/*.test.js` with vitest on the SDK's test host: the test saves the",
        "view there, which checks it as the desk does, and runs its source's query on items it puts",
        "in the test host's index.",
      ].join("\n"),
    ),
  ].join("\n");
}

const VIEW_TEST = `// The view on the SDK's test host: a desk in memory with an item index. \`desk plugin test <this
// folder>\` runs it with vitest.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTestHost } from "@endue-ai/plugin-sdk/testing";
import { expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"));
const { view } = manifest;
const source = { connector: "example.notes", instance: "default" };
const note = (id, title, updatedAt) => ({ id, source, kind: "note", title, updatedAt });

it("is a view the desk keeps, and lists the notes newest first", async () => {
  const host = createTestHost({ pluginId: manifest.id });
  // view.save checks the view as the desk does: its type, its source and its map.
  await host.call("view.save", { view, scope: { permission: "view:manage" } });

  host.upsert(note("older", "Older note", "2026-01-01T09:00:00Z"));
  host.upsert(note("newer", "Newer note", "2026-01-02T09:00:00Z"));
  // The view's source is an items query, which the desk runs when the view opens; the test host
  // holds fixture notes too, so read only the source these came from.
  const query = { ...view.source.items, sources: [\`\${source.connector}/\${source.instance}\`] };
  const { items } = await host.call("data.query", { query, scope: { permission: "data:read" } });
  expect(items.map((item) => item.title)).toEqual(["Newer note", "Older note"]);
});
`;
