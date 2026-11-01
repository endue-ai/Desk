import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { opener } from "../../../packages/runtime/src/policies/files";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/images");
const pluginSpec = join(root, "specs/plugin/v0");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  // The manifest references the item, view and connector specs, which reference it back.
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

/** Every extension the issue lists, in its order. */
const EXTENSIONS = (
  "png apng jpg jpeg jpe jfif pjpeg gif webp avif heic heif jxl bmp dib tif tiff ico cur icns svg " +
  "svgz tga pnm pbm pgm ppm pam qoi dds hdr exr ktx eps wmf emf dng cr2 cr3 crw nef nrw arw srf " +
  "sr2 orf rw2 raf pef srw 3fr erf kdc mrw dcm fits fit fts nii"
).split(" ");

const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;

describe("plugin.json", () => {
  it("is a UI plugin with one centre surface that opens every listed image format", () => {
    const validate = manifestValidator();
    const images = manifest();
    expect(validate(images), JSON.stringify(validate.errors)).toBe(true);
    expect(images.entry).toBe("ui/index.html");
    expect(existsSync(join(folder, images.entry ?? "missing"))).toBe(true);
    expect(images).toMatchObject({ id: "endue.images", name: "Images", kind: "ui" });
    expect(images.surfaces).toEqual([{ id: "main", title: "Images", placement: "center" }]);
    expect(images.contributes?.files).toEqual(
      EXTENSIONS.map((ext) => ({ pattern: `*.${ext}`, plugin: "endue.images" })),
    );
  });

  it("declares no fs paths of its own: it asks for a file's folder when it needs to", () => {
    const permissions = manifest().permissions ?? [];
    expect(permissions.filter((p) => p.permission.startsWith("fs:"))).toEqual([]);
    expect(permissions).toEqual([
      {
        permission: "cmd:invoke",
        ids: ["desk.files.changed", "desk.files.open", "desk.buffers.close"],
      },
    ]);
  });

  it("the desk's opener rule picks images for each listed extension and nobody for .psd", () => {
    // Layered as the runtime does (packages/runtime/src/policy.ts): each rule carries its owner.
    const owner = "endue.images";
    const rules = (manifest().contributes?.files ?? []).map((rule) => ({ ...rule, owner }));
    for (const ext of EXTENSIONS)
      expect(opener(rules, `~/Pictures/photo.${ext}`), ext).toBe("endue.images");
    expect(opener(rules, "~/Pictures/layers.psd")).toBeUndefined();
    expect(opener(rules, "~/Pictures/notes.txt")).toBeUndefined();
  });

  it("autoloads: off at start, on when a file needs it, off after its last one (ADR 0046)", () => {
    expect(manifest().autoload).toBe(true);
  });
});
