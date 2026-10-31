import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { opener } from "../../../packages/runtime/src/policies/files";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/reader");
const pluginSpec = join(root, "specs/plugin/v0");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  // The manifest references the item, view and connector specs, which reference it back.
  for (const spec of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
    const dir = join(pluginSpec, "../..", spec);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(readJson(join(dir, name)) as object);
  }
  const validate = ajv.getSchema("https://endue.ai/specs/plugin/v0/plugin.schema.json");
  if (!validate) throw new Error("cannot compile plugin.schema.json");
  return validate;
}

const EXTENSIONS = "pdf xps oxps epub mobi azw azw3 prc fb2 cbz cbt cbr cb7 djvu djv".split(" ");

const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;

describe("plugin.json", () => {
  it("is a UI plugin with one centre surface that opens the 15 listed formats", () => {
    const validate = manifestValidator();
    const reader = manifest();
    expect(validate(reader), JSON.stringify(validate.errors)).toBe(true);
    expect(reader.entry).toBe("ui/index.html");
    expect(existsSync(join(folder, reader.entry ?? "missing"))).toBe(true);
    expect(reader).toMatchObject({ id: "endue.reader", name: "Reader", kind: "ui" });
    expect(reader.surfaces).toEqual([{ id: "main", title: "Reader", placement: "center" }]);
    expect(reader.contributes?.files).toEqual(
      EXTENSIONS.map((ext) => ({ pattern: `*.${ext}`, plugin: "endue.reader" })),
    );
    expect(EXTENSIONS).toHaveLength(15);
  });

  it("declares no fs paths of its own: it asks for a file's folder when it needs to", () => {
    const permissions = manifest().permissions ?? [];
    expect(permissions.filter((p) => p.permission.startsWith("fs:"))).toEqual([]);
    expect(permissions).toEqual([{ permission: "cmd:invoke", ids: ["desk.files.changed"] }]);
  });

  it("the desk's opener rule picks the reader for each listed extension and nobody for .docx", () => {
    // Layered as the runtime does (packages/runtime/src/policy.ts): each rule carries its owner.
    const owner = "endue.reader";
    const rules = (manifest().contributes?.files ?? []).map((rule) => ({ ...rule, owner }));
    for (const ext of EXTENSIONS)
      expect(opener(rules, `~/Books/a book.${ext}`), ext).toBe("endue.reader");
    expect(opener(rules, "~/Books/letter.docx")).toBeUndefined();
    expect(opener(rules, "~/Books/notes.txt")).toBeUndefined();
  });

  it("vendors pdf.js: the frame loads it from ui/vendor, never from the network", () => {
    for (const name of [
      "pdf.min.mjs",
      "pdf.worker.min.mjs",
      "pdf_layers.css",
      "LICENSE",
      "VERSIONS",
    ])
      expect(existsSync(join(folder, "ui/vendor", name)), name).toBe(true);
    const html = readFileSync(join(folder, "ui/index.html"), "utf8");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain("./vendor/pdf_layers.css");
  });
});
