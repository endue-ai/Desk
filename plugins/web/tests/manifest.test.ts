import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { opener } from "../../../packages/runtime/src/policies/files";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/web");
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

const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;

const EXTENSIONS = [
  "html",
  "htm",
  "xhtml",
  "xht",
  "shtml",
  "mhtml",
  "mht",
  "webarchive",
  "warc",
  "maff",
  "url",
  "webloc",
  "desktop",
  "lnk",
  "rss",
  "atom",
  "opml",
  "warc.gz",
];

describe("plugin.json", () => {
  it("is a UI plugin with one center surface and the 17 web patterns plus *.warc.gz", () => {
    const validate = manifestValidator();
    const web = manifest();
    expect(validate(web), JSON.stringify(validate.errors)).toBe(true);
    expect(web.entry).toBe("ui/index.html");
    expect(existsSync(join(folder, web.entry ?? "missing"))).toBe(true);
    expect(web).toMatchObject({ id: "endue.web", name: "Web", kind: "ui" });
    expect(web.surfaces).toEqual([{ id: "main", title: "Web", placement: "center" }]);
    expect(web.contributes?.files).toEqual(
      EXTENSIONS.map((ext) => ({ pattern: `*.${ext}`, plugin: "endue.web" })),
    );
  });

  it("runs desk.files.open and desk.files.changed and declares no file paths of its own", () => {
    expect(manifest().permissions).toEqual([
      { permission: "cmd:invoke", ids: ["desk.files.open", "desk.files.changed"] },
    ]);
  });

  it("the desk's opener rule picks web for every listed format", () => {
    // Layered as the runtime does (packages/runtime/src/policy.ts): each rule carries its owner.
    const owner = "endue.web";
    const rules = (manifest().contributes?.files ?? []).map((rule) => ({ ...rule, owner }));
    for (const ext of EXTENSIONS) expect(opener(rules, `~/Saved/page.${ext}`), ext).toBe(owner);
    expect(opener(rules, "~/Saved/crawl-00001.warc.gz")).toBe(owner);
    expect(opener(rules, "~/Saved/notes.md")).toBeUndefined();
    expect(opener(rules, "~/Saved/backup.tar.gz")).toBeUndefined();
  });
});
