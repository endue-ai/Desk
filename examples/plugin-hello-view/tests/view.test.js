// The view on the SDK's test host: a desk in memory with an item index. `desk plugin test <this
// folder>` runs it with vitest.
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
  const query = { ...view.source.items, sources: [`${source.connector}/${source.instance}`] };
  const { items } = await host.call("data.query", { query, scope: { permission: "data:read" } });
  expect(items.map((item) => item.title)).toEqual(["Newer note", "Older note"]);
});
