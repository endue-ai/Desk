// The plugin on the SDK's test host: a desk in memory that answers the bridge, no app or browser.
// `desk plugin test examples/plugin-hello-ui` runs it with vitest, in a jsdom page.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createTestHost } from "@endue-ai/plugin-sdk/testing";
import { expect, it } from "vitest";
import { plugin } from "../ui/plugin.js";

// The plugin's own files, by their path in the folder.
const read = (path) => readFileSync(join(import.meta.dirname, "..", path), "utf8");
const manifest = JSON.parse(read("plugin.json"));

it("counts into plugin state and shows its bridge round trip", async () => {
  document.documentElement.innerHTML = read("ui/index.html");
  // A reload: the desk hands the plugin the state it saved.
  const host = createTestHost({ pluginId: manifest.id, state: { count: 2 } });
  await defineUiPlugin(plugin, host.transport);
  await host.settle();

  const count = document.querySelector("[data-testid=count]");
  expect(count.textContent).toBe("2");
  document.querySelector("desk-button").click();
  expect(count.textContent).toBe("3");
  expect(host.state).toEqual({ count: 3 });
  expect(host.calls.map((call) => call.method)).toEqual(["perm.query"]);
  expect(document.querySelector("[data-testid=bridge]").textContent).toBe("bridge: ok, 0 grants");
});
