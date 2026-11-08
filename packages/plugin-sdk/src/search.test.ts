import { expect, it } from "vitest";
import { defineUiPlugin } from "./index";
import { createTestHost } from "./testing/index";

it("publishes and clears caller-owned documents through the core bridge", async () => {
  const host = createTestHost({
    pluginId: "example.notes",
    handlers: { "search.replace": () => ({}) },
  });
  const ctx = await defineUiPlugin({ mount() {} }, host.transport);
  const documents = [{ id: "a", title: "Plan", text: "meeting", command: "example.notes.open" }];
  await ctx.search.replace(documents);
  await ctx.search.replace([]);
  expect(host.calls.filter((c) => c.method === "search.replace").map((c) => c.params)).toEqual([
    { documents },
    { documents: [] },
  ]);
});
