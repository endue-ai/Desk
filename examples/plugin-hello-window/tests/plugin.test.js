// The app on the SDK's test host: a desk in memory that answers the bridge, no app or browser.
// `desk plugin test examples/plugin-hello-window` runs it with vitest, in a jsdom page. The same
// page in both windows of the real desk: e2e/specs/app-opens-out.spec.ts and app-opens-canvas.spec.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createTestHost } from "@endue-ai/plugin-sdk/testing";
import { expect, it } from "vitest";
import { plugin } from "../ui/plugin.js";

// The plugin's own files, by their path in the folder.
const read = (path) => readFileSync(join(import.meta.dirname, "..", path), "utf8");
const manifest = JSON.parse(read("plugin.json"));

it("says how its window opens: a first size, a smallest size, out of the canvas", () => {
  expect(manifest.surfaces[0].window).toEqual({
    size: { width: 480, height: 360 },
    minSize: { width: 320, height: 240 },
    opens: "out",
  });
});

it("shows its page's size and counts into plugin state, which a move in or out gives back", async () => {
  document.documentElement.innerHTML = read("ui/index.html");
  // The page after a move: the desk hands the plugin the state it saved.
  const host = createTestHost({ pluginId: manifest.id, state: { count: 2 } });
  await defineUiPlugin(plugin, host.transport);
  await host.settle();

  const size = document.querySelector("[data-testid=size]");
  expect(size.textContent).toBe(`${window.innerWidth} × ${window.innerHeight}`);
  const count = document.querySelector("[data-testid=count]");
  expect(count.textContent).toBe("2");
  document.querySelector("desk-button").click();
  expect(count.textContent).toBe("3");
  expect(host.state).toEqual({ count: 3 });
  expect(document.querySelector("[data-testid=bridge]").textContent).toBe("bridge: ok, 0 grants");
});
