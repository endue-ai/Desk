import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";

const root = join(import.meta.dirname, "../../..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  // The manifest references the item, view and connector specs, which reference it back.
  for (const spec of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
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
  const manifest = readJson(join(root, "plugins/browser/plugin.json")) as PluginManifest;

  it("is a UI plugin with a centre surface, off until the person opens it", () => {
    const validate = manifestValidator();
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest).toMatchObject({
      id: "endue.browser",
      name: "Browser",
      kind: "ui",
      entry: "ui/index.html",
      autoload: true,
      surfaces: [{ id: "main", title: "Browser", placement: "center" }],
    });
  });

  it("asks to show web pages and nothing more", () => {
    expect(manifest.permissions).toEqual([{ permission: "web:browse" }]);
  });

  it("offers its commands under its own id, and the settings its page reads", () => {
    const ids = manifest.contributes?.commands?.map((c) => c.id);
    expect(ids).toEqual(["endue.browser.open", "endue.browser.go", "endue.browser.reload"]);
    expect(Object.keys(manifest.contributes?.settings ?? {})).toEqual([
      "endue.browser.home",
      "endue.browser.search",
    ]);
  });
});
