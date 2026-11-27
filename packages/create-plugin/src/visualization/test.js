import { readFileSync } from "node:fs";
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { createTestHost } from "@endue-ai/plugin-sdk/testing";
import { expect, it } from "vitest";
import { plugin } from "../ui/plugin.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const manifest = JSON.parse(read("../plugin.json"));

it("updates the displayed chart through the command and keeps its rows", async () => {
  document.documentElement.innerHTML = read("../ui/index.html");
  const host = createTestHost({ pluginId: manifest.id });
  for (const { id, title } of manifest.contributes.commands) {
    await host.call("cmd.register", { id, title }, manifest.id);
  }
  await defineUiPlugin(plugin, host.transport);
  await host.settle();
  const rows = [{ label: "<em>April</em>", value: 8 }];
  expect(await host.invoke(`${manifest.id}.set-data`, { rows })).toEqual({ rows });
  expect(await host.invoke(`${manifest.id}.get-data`)).toEqual({ rows });
  expect(host.state).toEqual({ rows });
  expect(document.querySelector("#chart li").textContent).toBe("<em>April</em>8");
  expect(document.querySelector("#chart em")).toBeNull();
});
