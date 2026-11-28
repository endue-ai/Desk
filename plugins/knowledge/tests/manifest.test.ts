import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { lintPlugin } from "../../../scripts/ui-lint.mjs";
import { COMMAND_IDS, SEARCH_KINDS } from "../ui/commands.js";
import { DEFAULTS, MANAGE, READ, WRITE } from "../ui/kinds.js";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/knowledge");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;

function validator(id: string) {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const spec of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
    const dir = join(root, "specs", spec);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(readJson(join(dir, name)) as object);
  }
  const validate = ajv.getSchema(id);
  if (!validate) throw new Error(`cannot compile ${id}`);
  return validate;
}

describe("plugin.json", () => {
  it("is a valid UI plugin, off until turned on, that reads only the sessions connector", () => {
    const validate = validator("https://endue.ai/specs/plugin/v0/plugin.schema.json");
    const plugin = manifest();
    expect(validate(plugin), JSON.stringify(validate.errors)).toBe(true);
    expect(existsSync(join(folder, plugin.entry ?? "missing"))).toBe(true);
    expect(plugin).toMatchObject({ id: "endue.knowledge", kind: "ui", autoload: true });
    expect(plugin.permissions).toEqual([
      READ,
      MANAGE,
      WRITE,
      { permission: "cmd:invoke", ids: ["desk.files.open"] },
    ]);
  });

  it("declares the commands the plugin handles; the three read-only ones are agent tools", () => {
    const commands = manifest().contributes?.commands ?? [];
    expect(commands.map((c) => c.id)).toEqual(COMMAND_IDS);
    const tools = commands.filter((c) => c.agent);
    expect(tools.map((c) => c.id)).toEqual([
      "endue.knowledge.search",
      "endue.knowledge.related",
      "endue.knowledge.note",
    ]);
    for (const tool of tools) {
      expect(tool.readOnly).toBe(true);
      expect((tool.args as { required?: unknown }).required).toBeUndefined();
    }
    type Args = { properties: { kinds: { items: { enum: string[] } } } };
    const search = commands[3]?.args as Args | undefined;
    const kinds = search?.properties.kinds.items.enum;
    expect(kinds).toEqual(SEARCH_KINDS);
  });

  it("declares the settings the plugin reads, with its defaults", () => {
    const settings = manifest().contributes?.settings ?? {};
    for (const [key, value] of Object.entries(DEFAULTS))
      expect(
        (settings as Record<string, { default: unknown }>)[`endue.knowledge.${key}`]?.default,
      ).toBe(value);
  });

  it("uses theme tokens only", () => {
    expect(lintPlugin("knowledge")).toEqual([]);
  });
});
