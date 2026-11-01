import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { SETTING_KEYS } from "../ui/settings.js";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/database");
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

const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;

/** Every file under a folder, recursively. */
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

describe("plugin.json", () => {
  it("is a UI plugin that runs only the three engines' clients and opens one center surface", () => {
    const validate = manifestValidator();
    const db = manifest();
    expect(validate(db), JSON.stringify(validate.errors)).toBe(true);
    expect(db).toMatchObject({
      id: "endue.database",
      name: "Database",
      kind: "ui",
      entry: "ui/index.html",
    });
    expect(existsSync(join(folder, db.entry ?? "missing"))).toBe(true);
    expect(db.surfaces).toEqual([{ id: "main", title: "Database", placement: "center" }]);
    expect(db.permissions).toEqual([
      { permission: "proc:spawn", commands: ["psql", "mysql", "mariadb", "sqlite3"] },
      {
        permission: "cmd:invoke",
        ids: [
          "desk.palette.pick",
          "desk.buffers.open",
          "desk.buffers.update",
          "desk.buffers.close",
        ],
      },
    ]);
  });

  it("contributes every operation as a command, one key, SQLite files and the settings the code reads", () => {
    const { contributes } = manifest();
    const ids = contributes?.commands?.map((c) => c.id) ?? [];
    expect(ids).toHaveLength(22);
    for (const command of contributes?.commands ?? []) {
      expect(command.id).toMatch(/^endue\.database\.[a-z-]+$/u);
      expect(command.title).toMatch(/^Database: /u);
    }
    const source = readFileSync(join(folder, "ui/database.js"), "utf8");
    for (const id of ids) expect(source, id).toContain(`"${id}"`);
    expect(contributes?.keys).toEqual([{ key: "Mod+Shift+B", command: "endue.database.open" }]);
    expect(contributes?.files?.map((f) => f.pattern)).toEqual(["*.sqlite", "*.sqlite3", "*.db3"]);
    expect(Object.keys(contributes?.settings ?? {})).toEqual(SETTING_KEYS);
  });

  it("keeps every source file under 400 lines and the README under 40", () => {
    for (const path of [...files(join(folder, "ui")), ...files(join(folder, "tests"))]) {
      const text = readFileSync(path, "utf8");
      const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
      expect(lines, path).toBeLessThanOrEqual(400);
    }
    const readme = readFileSync(join(folder, "README.md"), "utf8").trimEnd().split("\n");
    expect(readme.length).toBeLessThanOrEqual(40);
  });

  it("imports the SDK only in main.js, so every other module runs under the tests", () => {
    for (const path of files(join(folder, "ui")).filter(
      (p) => p.endsWith(".js") && !p.endsWith("main.js"),
    ))
      expect(readFileSync(path, "utf8"), path).not.toMatch(/from "@endue-ai\/plugin-sdk"/u);
  });
});
