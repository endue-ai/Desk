import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/views");
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
  it("is a UI plugin on one hidden overlay with its commands and permissions", () => {
    const validate = manifestValidator();
    const views = readJson(join(folder, "plugin.json")) as PluginManifest;
    expect(validate(views), JSON.stringify(validate.errors)).toBe(true);
    expect(views).toMatchObject({ id: "desk.views", name: "Views", kind: "ui" });
    expect(views.entry).toBe("ui/index.html");
    expect(existsSync(join(folder, views.entry ?? "missing"))).toBe(true);
    expect(views.surfaces).toEqual([
      { id: "main", title: "Views", placement: "overlay", hidden: true },
    ]);
    expect(views.permissions).toEqual([
      { permission: "data:read" },
      { permission: "connector:manage" },
      { permission: "view:manage" },
      { permission: "cmd:invoke", ids: ["*"] },
      { permission: "shell:open", schemes: ["http", "https", "mailto"] },
    ]);
    expect(views.contributes?.commands?.map((command) => command.id)).toEqual([
      "desk.views.open",
      "desk.views.close",
      "desk.views.reconnect",
      "desk.views.request-access",
      "desk.views.open-original",
    ]);
  });
});
