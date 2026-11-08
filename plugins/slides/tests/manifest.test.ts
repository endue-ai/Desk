import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { opener } from "../../../packages/runtime/src/policies/files";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/slides");
const pluginSpec = join(root, "specs/plugin/v0");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const folder of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
    const dir = join(pluginSpec, "../..", folder);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(readJson(join(dir, name)) as object);
  }
  const validate = ajv.getSchema("https://endue.ai/specs/plugin/v0/plugin.schema.json");
  if (!validate) throw new Error("cannot compile plugin.schema.json");
  return validate;
}

const PATTERNS = [
  "*.pptx",
  "*.pptm",
  "*.ppsx",
  "*.ppsm",
  "*.potx",
  "*.potm",
  "*.ppt",
  "*.pps",
  "*.pot",
  "*.odp",
  "*.otp",
  "*.fodp",
  "*.key",
  "*.gslides",
];

const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;

describe("plugin.json", () => {
  it("is a UI plugin with one center surface and the 14 presentation patterns", () => {
    const validate = manifestValidator();
    const slides = manifest();
    expect(validate(slides), JSON.stringify(validate.errors)).toBe(true);
    expect(slides.entry).toBe("ui/index.html");
    expect(existsSync(join(folder, slides.entry ?? "missing"))).toBe(true);
    expect(slides).toMatchObject({ id: "endue.slides", name: "Slides", kind: "ui" });
    expect(slides.surfaces).toEqual([{ id: "main", title: "Slides", placement: "center" }]);
    expect(slides.contributes?.files).toEqual(
      PATTERNS.map((pattern) => ({ pattern, plugin: "endue.slides" })),
    );
    // No fs paths of its own: it asks for a file's folder when it opens one.
    expect(slides.permissions).toEqual([{ permission: "cmd:invoke", ids: ["desk.files.changed"] }]);
  });

  it("the desk's opener picks slides for every pattern and nobody for other files", () => {
    const owner = "endue.slides";
    const rules = (manifest().contributes?.files ?? []).map((rule) => ({ ...rule, owner }));
    for (const pattern of PATTERNS) {
      const path = `~/Decks/Talk ${pattern.slice(2)}.${pattern.slice(2)}`;
      expect(opener(rules, path), path).toBe("endue.slides");
    }
    expect(opener(rules, "~/Decks/notes.md")).toBeUndefined();
    expect(opener(rules, "~/Decks/sheet.xlsx")).toBeUndefined();
  });

  it("autoloads: off at start, on when a file needs it, off after its last one (ADR 0046)", () => {
    expect(manifest().autoload).toBe(true);
  });
});
