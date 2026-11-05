import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";

const root = join(import.meta.dirname, "../../..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const manifest = readJson(join(root, "plugins/memory/plugin.json")) as PluginManifest;

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
      id: "endue.memory",
      kind: "ui",
      entry: "ui/index.html",
      autoload: true,
      surfaces: [{ id: "main", title: "Memory", placement: "center" }],
    });
  });

  it("asks for reading and keeping memory, and nothing more", () => {
    expect(manifest.permissions).toEqual([
      { permission: "memory:read" },
      { permission: "memory:write" },
    ]);
  });

  it("opens from the palette through desk.plugins.open", () => {
    expect(manifest.contributes?.commands).toEqual([
      expect.objectContaining({
        id: "endue.memory.open",
        runs: { command: "desk.plugins.open", args: { plugin: "endue.memory" } },
      }),
    ]);
  });
});
