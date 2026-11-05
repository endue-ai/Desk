// The plugin on the SDK's test host, in a jsdom page: the asset comes from this folder.
// `desk plugin test examples/plugin-hello-universal` runs it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createTestHost } from "@endue-ai/plugin-sdk/testing";
import { afterEach, expect, it, vi } from "vitest";
import { plugin, VIEW } from "../ui/plugin.js";

const read = (path) => readFileSync(join(import.meta.dirname, "..", path), "utf8");
const manifest = JSON.parse(read("plugin.json"));

afterEach(() => vi.unstubAllGlobals());

it("draws the board from its YAML asset, in the presentation kept in state", async () => {
  document.body.innerHTML = '<main id="root"></main>';
  const fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => read("data/board.yaml"),
  }));
  vi.stubGlobal("fetch", fetch);
  const host = createTestHost({ pluginId: manifest.id, state: { type: "timeline" } });
  let view;
  await defineUiPlugin({ mount: (ctx) => (view = plugin.mount(ctx)) }, host.transport);
  await vi.waitFor(() => expect(view.data).not.toBeNull());

  expect(String(fetch.mock.calls[0][0])).toMatch(/data\/board\.yaml$/);
  expect(view.element.view).toMatchObject({ type: "timeline", types: VIEW.types });
  expect(view.element.getAttribute("state")).toBe("ready");
  expect(view.data.title).toBe("Launch");
  expect(view.data.entries.map((entry) => entry.column)).toEqual(["done", "doing", "todo", "todo"]);

  view.element.dispatchEvent(new CustomEvent("desk-type", { detail: { type: "calendar" } }));
  expect(host.state).toEqual({ type: "calendar" });
  view.close();
});
