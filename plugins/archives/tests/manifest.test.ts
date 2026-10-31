import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { opener } from "../../../packages/runtime/src/policies/files";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/archives");
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

/** Every pattern the issue lists, in its order. */
const PATTERNS = (
  "*.zip *.zipx *.jar *.war *.ear *.apk *.aab *.ipa *.xpi *.crx *.nupkg *.whl *.egg *.appx " +
  "*.appxbundle *.msix *.msixbundle *.tar *.tgz *.tbz *.tbz2 *.txz *.tzst *.gz *.bz2 *.xz *.lzma " +
  "*.zst *.lz4 *.Z *.7z *.rar *.cab *.iso *.deb *.rpm *.gem *.pkg *.xar *.msi *.dmg *.img *.vhd " +
  "*.vhdx *.vmdk *.qcow2 *.wim *.snap *.AppImage *.arj *.lha *.lzh *.torrent"
).split(" ");

const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;

describe("plugin.json", () => {
  it("is a UI plugin with one center surface that opens every listed format", () => {
    const validate = manifestValidator();
    const archives = manifest();
    expect(validate(archives), JSON.stringify(validate.errors)).toBe(true);
    expect(archives).toMatchObject({ id: "endue.archives", name: "Archives", kind: "ui" });
    expect(archives.entry).toBe("ui/index.html");
    expect(existsSync(join(folder, archives.entry ?? "missing"))).toBe(true);
    expect(archives.surfaces).toEqual([{ id: "main", title: "Archives", placement: "center" }]);
    expect(archives.contributes?.files).toEqual(
      PATTERNS.map((pattern) => ({ pattern, plugin: "endue.archives" })),
    );
  });

  it("declares no file paths of its own: every read and write is asked for", () => {
    const permissions = manifest().permissions ?? [];
    expect(permissions.filter((p) => p.permission.startsWith("fs:"))).toEqual([]);
    expect(permissions).toEqual([
      { permission: "cmd:invoke", ids: ["desk.files.changed", "desk.palette.pick"] },
    ]);
  });

  it("the desk's opener picks endue.archives for each pattern and compound names", () => {
    const owner = "endue.archives";
    const rules = (manifest().contributes?.files ?? []).map((rule) => ({ ...rule, owner }));
    for (const pattern of PATTERNS) {
      const name = `~/Downloads/x${pattern.slice(1)}`;
      expect(opener(rules, name), name).toBe(owner);
    }
    for (const name of ["x.tar.gz", "x.tar.zst", "x.Z", "x.AppImage", "SETUP.EXE.ZIP", "a.TGZ"])
      expect(opener(rules, `~/Downloads/${name}`), name).toBe(owner);
    expect(opener(rules, "~/Downloads/x.txt")).toBeUndefined();
  });
});
