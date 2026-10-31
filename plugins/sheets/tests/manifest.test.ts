import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { opener } from "../../../packages/runtime/src/policies/files";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/sheets");
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

const EXTENSIONS = [
  "xlsx",
  "xlsm",
  "xlsb",
  "xls",
  "xlt",
  "xltx",
  "xltm",
  "ods",
  "ots",
  "fods",
  "numbers",
  "csv",
  "tsv",
  "dif",
  "slk",
  "sylk",
  "wk1",
  "wk3",
  "wk4",
  "wks",
  "123",
  "qpw",
  "gsheet",
];

const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;

describe("plugin.json", () => {
  it("is a UI plugin with one center surface that opens the 23 spreadsheet patterns", () => {
    const validate = manifestValidator();
    const sheets = manifest();
    expect(validate(sheets), JSON.stringify(validate.errors)).toBe(true);
    expect(sheets.entry).toBe("ui/index.html");
    expect(existsSync(join(folder, sheets.entry ?? "missing"))).toBe(true);
    expect(sheets).toMatchObject({ id: "endue.sheets", name: "Sheets", kind: "ui" });
    expect(sheets.surfaces).toEqual([{ id: "main", title: "Sheets", placement: "center" }]);
    expect(EXTENSIONS).toHaveLength(23);
    expect(sheets.contributes?.files).toEqual(
      EXTENSIONS.map((ext) => ({ pattern: `*.${ext}`, plugin: "endue.sheets" })),
    );
  });

  it("declares no file paths of its own and the csv-encoding setting", () => {
    const sheets = manifest();
    const kinds = (sheets.permissions ?? []).map((p) => p.permission);
    expect(kinds).not.toContain("fs:read");
    expect(kinds).not.toContain("fs:write");
    expect(sheets.permissions).toEqual([{ permission: "cmd:invoke", ids: ["desk.files.changed"] }]);
    expect(sheets.contributes?.settings?.["endue.sheets.csv-encoding"]).toMatchObject({
      kind: "string",
      default: "auto",
      choices: ["auto", "utf-8", "euc-kr", "shift_jis", "windows-1252"],
    });
  });

  it("the desk's opener picks sheets for every listed extension and nobody else's", () => {
    // Layered as the runtime does (packages/runtime/src/policy.ts): each rule carries its owner,
    // and every built-in plugin's rules are in the set.
    const plugins = readdirSync(join(root, "plugins")).filter((name) =>
      existsSync(join(root, "plugins", name, "plugin.json")),
    );
    const rules = plugins.flatMap((name) => {
      const other = readJson(join(root, "plugins", name, "plugin.json")) as PluginManifest;
      return (other.contributes?.files ?? []).map((rule) => ({ ...rule, owner: other.id }));
    });
    for (const ext of EXTENSIONS) {
      expect(opener(rules, `~/Documents/report.${ext}`), ext).toBe("endue.sheets");
    }
    const own = (manifest().contributes?.files ?? []).map((r) => ({ ...r, owner: "endue.sheets" }));
    for (const path of ["~/a.md", "~/a.txt", "~/a.ics", "~/a.sqlite", "~/a.json", "~/a.xml"]) {
      expect(opener(own, path), path).toBeUndefined();
    }
  });
});
