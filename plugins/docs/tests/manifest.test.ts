import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { opener } from "../../../packages/runtime/src/policies/files";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/docs");
const pluginSpec = join(root, "specs/plugin/v0");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  // The manifest references the item, view and connector specs, which reference it back.
  for (const name of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
    const dir = join(pluginSpec, "../..", name);
    for (const file of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(readJson(join(dir, file)) as object);
  }
  const validate = ajv.getSchema("https://endue.ai/specs/plugin/v0/plugin.schema.json");
  if (!validate) throw new Error("cannot compile plugin.schema.json");
  return validate;
}

const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;

const EXTENSIONS = [
  "docx",
  "docm",
  "dotx",
  "dotm",
  "doc",
  "dot",
  "odt",
  "ott",
  "fodt",
  "sxw",
  "rtf",
  "pages",
  "hwp",
  "hwpx",
  "abw",
  "wpd",
  "wps",
  "gdoc",
];

describe("plugin.json", () => {
  it("is a UI plugin with one center surface and the 18 file patterns", () => {
    const validate = manifestValidator();
    const docs = manifest();
    expect(validate(docs), JSON.stringify(validate.errors)).toBe(true);
    expect(docs).toMatchObject({
      id: "endue.docs",
      name: "Docs",
      kind: "ui",
      entry: "ui/index.html",
    });
    expect(existsSync(join(folder, docs.entry ?? "missing"))).toBe(true);
    expect(docs.surfaces).toEqual([{ id: "main", title: "Docs", placement: "center" }]);
    expect(docs.contributes?.files).toEqual(
      EXTENSIONS.map((ext) => ({ pattern: `*.${ext}`, plugin: "endue.docs" })),
    );
  });

  it("declares no file paths of its own: every read is asked for", () => {
    const permissions = manifest().permissions ?? [];
    expect(permissions.filter((p) => p.permission.startsWith("fs:"))).toEqual([]);
    expect(permissions).toEqual([{ permission: "cmd:invoke", ids: ["desk.files.changed"] }]);
  });

  it("the desk's opener picks endue.docs for each format and nobody for .pdf", () => {
    const owner = "endue.docs";
    const rules = (manifest().contributes?.files ?? []).map((rule) => ({ ...rule, owner }));
    for (const ext of EXTENSIONS) {
      expect(opener(rules, `~/Documents/Report.${ext}`), ext).toBe("endue.docs");
    }
    expect(opener(rules, "~/Documents/report.pdf")).toBeUndefined();
  });
});
