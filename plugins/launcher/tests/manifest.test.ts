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
  const manifest = readJson(join(root, "plugins/launcher/plugin.json")) as PluginManifest;

  it("is a UI plugin over the whole app, hidden until it is asked for", () => {
    const validate = manifestValidator();
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest).toMatchObject({
      id: "endue.launcher",
      name: "Launcher",
      kind: "ui",
      entry: "ui/index.html",
      surfaces: [{ id: "main", title: "Launcher", placement: "overlay", hidden: true }],
    });
    // On from the start: the account bar's button and the key run its command.
    expect(manifest.autoload).toBeUndefined();
  });

  it("asks to list the plugins and to open one, and nothing more", () => {
    expect(manifest.permissions).toEqual([
      { permission: "plugin:manage" },
      { permission: "cmd:invoke", ids: ["desk.plugins.open"] },
    ]);
  });

  it("offers open and close, and a key for open", () => {
    const ids = manifest.contributes?.commands?.map((c) => c.id);
    expect(ids).toEqual(["endue.launcher.open", "endue.launcher.close"]);
    expect(manifest.contributes?.keys).toEqual([
      { key: "Mod+Alt+L", command: "endue.launcher.open" },
    ]);
  });
});
