import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";

const root = join(import.meta.dirname, "../../..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const manifest = readJson(join(root, "plugins/agents/plugin.json")) as PluginManifest;

function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const spec of ["plugin/v0", "item/v0", "view/v0", "connector/v0", "memory/v0"]) {
    const dir = join(root, "specs", spec);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(readJson(join(dir, name)) as object);
  }
  const validate = ajv.getSchema("https://endue.ai/specs/plugin/v0/plugin.schema.json");
  if (!validate) throw new Error("cannot compile plugin.schema.json");
  return validate;
}

describe("plugin.json", () => {
  it("is a UI plugin with a centre surface, off until the person opens it", () => {
    const validate = manifestValidator();
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest).toMatchObject({
      id: "endue.agents",
      kind: "ui",
      entry: "ui/index.html",
      autoload: true,
      surfaces: [{ id: "main", title: "Agents", placement: "center" }],
    });
  });

  it("asks for endue agents, local agents, endue.ai's pages and signing in, and nothing more", () => {
    expect(manifest.permissions).toEqual([
      { permission: "studio:manage" },
      { permission: "agents:manage" },
      { permission: "shell:open", schemes: ["https"] },
      { permission: "cmd:invoke", ids: ["desk.account.sign-in"] },
    ]);
  });

  it("opens from the palette through desk.plugins.open, under its own endue.agents id", () => {
    expect(manifest.contributes?.commands).toEqual([
      expect.objectContaining({
        id: "endue.agents.open",
        runs: { command: "desk.plugins.open", args: { plugin: "endue.agents" } },
      }),
    ]);
    // A short description: every built-in plugin's text goes into one prompt (32000 characters).
    expect(manifest.description?.length ?? 0).toBeLessThan(200);
  });
});
