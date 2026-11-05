import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/universal");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
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
  it("is a UI plugin on one hidden overlay that opens, builds, closes, allows and previews universal views", () => {
    const validate = manifestValidator();
    const manifest = readJson(join(folder, "plugin.json")) as PluginManifest;
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest).toMatchObject({ id: "desk.universal", name: "Universal View", kind: "ui" });
    expect(existsSync(join(folder, manifest.entry ?? "missing"))).toBe(true);
    expect(manifest.surfaces).toEqual([
      { id: "main", title: "Universal View", placement: "overlay", hidden: true },
    ]);
    expect(manifest.permissions).toEqual([
      { permission: "data:read" },
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a desk path rooted at ${home}, not a template
      { permission: "fs:read", paths: ["${home}/**"] },
      { permission: "cmd:invoke", ids: ["*"] },
      // Saved views: open by id, the builder's Save (ADR 0102).
      { permission: "view:manage" },
    ]);
    expect(manifest.contributes?.commands?.map((command) => command.id)).toEqual([
      "desk.universal.open",
      "desk.universal.build",
      "desk.universal.close",
      "desk.universal.allow",
      "desk.universal.drafting",
      "desk.universal.preview",
      "desk.universal.folder",
    ]);
  });
});
