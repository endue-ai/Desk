import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/formats");
const lib = join(folder, "lib");
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

/** Every module under lib/, as a path relative to it. */
function modules(dir = lib): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return modules(path);
    return name.endsWith(".js") ? [relative(lib, path)] : [];
  });
}

/** The specifiers a module imports: static, dynamic and in JSDoc types. */
const specifiers = (source: string) =>
  [
    ...source.matchAll(/\bfrom\s+"([^"]+)"|\bimport\s*\(\s*"([^"]+)"\s*\)|^import\s+"([^"]+)"/gm),
  ].map((m) => m[1] ?? m[2] ?? m[3] ?? "");

/** The folder names other tasks build on (#181): one per format family. */
const FAMILIES = ["codecs", "sevenzip", "rar", "djvu", "disk", "apple", "packs"];

const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;

describe("plugin.json", () => {
  it("is endue.formats, a library: no entry, no surfaces, no contributions, no permissions", () => {
    const validate = manifestValidator();
    const formats = manifest();
    expect(validate(formats), JSON.stringify(validate.errors)).toBe(true);
    expect(formats).toMatchObject({ id: "endue.formats", name: "Formats", kind: "library" });
    expect(formats.entry).toBeUndefined();
    expect(formats.permissions).toBeUndefined();
    expect(formats.surfaces).toBeUndefined();
    expect(formats.contributes).toBeUndefined();
    expect(formats.autoload).toBeUndefined();
  });

  it("the schema refuses a library that would run, ask or contribute", () => {
    const validate = manifestValidator();
    const base = { id: "example.lib", version: "0.1.0", kind: "library" };
    expect(validate(base)).toBe(true);
    for (const extra of [
      { entry: "lib/index.js" },
      { surfaces: [{ id: "main", placement: "center" }] },
      { permissions: [{ permission: "ui:notify" }] },
      { contributes: { commands: [] } },
      { autoload: true },
    ])
      expect(validate({ ...base, ...extra }), JSON.stringify(extra)).toBe(false);
  });
});

describe("lib/", () => {
  it("holds one folder per format family, under the names other plugins import", () => {
    const folders = readdirSync(lib).filter((name) => statSync(join(lib, name)).isDirectory());
    expect(folders).toEqual(expect.arrayContaining(["codecs", "sevenzip"]));
    for (const name of folders) expect(FAMILIES, name).toContain(name);
  });

  it("is plain code: relative imports that stay inside lib/, no SDK and no other plugin", () => {
    const found = modules();
    expect(found).toEqual(expect.arrayContaining(["codecs/index.js", "sevenzip/index.js"]));
    for (const module of found) {
      const file = join(lib, module);
      for (const specifier of specifiers(readFileSync(file, "utf8"))) {
        expect(specifier, `${module} imports ${specifier}`).toMatch(/^\.\.?\//);
        const target = resolve(dirname(file), specifier);
        expect(relative(lib, target).startsWith(".."), `${module} imports ${specifier}`).toBe(
          false,
        );
        expect(statSync(target).isFile(), `${module} imports ${specifier}`).toBe(true);
      }
    }
  });
});
