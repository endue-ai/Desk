import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { compileDesignSystem, trimRecipe } from "../../../packages/ui/src/design/index";

const root = join(import.meta.dirname, "../../..");
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const manifest = read(join(root, "plugins/design-compact/plugin.json")) as PluginManifest;

function validator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const spec of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
    const dir = join(root, "specs", spec);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(read(join(dir, name)) as object);
  }
  const validate = ajv.getSchema("https://endue.ai/specs/plugin/v0/plugin.schema.json");
  if (!validate) throw new Error("cannot compile plugin.schema.json");
  return validate;
}

describe("endue.design-compact", () => {
  it("is a valid design-system plugin", () => {
    const validate = validator();
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest.kind).toBe("design-system");
  });

  it("names only options that differ from the endue design system", () => {
    const components = manifest.designSystem?.components;
    expect(trimRecipe(components)).toEqual(components);
  });

  it("changes the component tokens", () => {
    const tokens = compileDesignSystem(manifest.designSystem?.components);
    expect(tokens).not.toEqual(compileDesignSystem());
  });
});
