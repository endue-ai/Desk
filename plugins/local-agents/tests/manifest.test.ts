import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { lintPlugin } from "../../../scripts/ui-lint.mjs";
import { COMMANDS as PROGRAMS } from "../ui/catalog.js";
import { COMMANDS } from "../ui/schemas.js";
import { CHOICES, DEFAULTS, RANGES, SETTING_KEYS } from "../ui/settings.js";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/local-agents");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function validator(id: string, specs: string[]) {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const spec of specs) {
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

const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;

describe("plugin.json", () => {
  it("is a UI plugin, off until turned on, that runs only the catalog's programs", () => {
    const validate = validator("https://endue.ai/specs/plugin/v0/plugin.schema.json", [
      "plugin/v0",
      "item/v0",
      "view/v0",
      "connector/v0",
    ]);
    const plugin = manifest();
    expect(validate(plugin), JSON.stringify(validate.errors)).toBe(true);
    expect(existsSync(join(folder, plugin.entry ?? "missing"))).toBe(true);
    // Claude and Codex are not on by default, and Eris does not offer them first (first-run rule).
    expect(plugin).toMatchObject({
      id: "endue.local-agents",
      name: "Local agents",
      kind: "ui",
      autoload: true,
    });
    expect(plugin.surfaces).toEqual([{ id: "main", title: "Local agents", placement: "center" }]);
    expect(plugin.permissions).toEqual([
      { permission: "proc:spawn", commands: [...PROGRAMS] },
      { permission: "cmd:invoke", ids: ["desk.palette.pick"] },
    ]);
  });

  it("contributes the commands the plugin registers, with the same titles and keywords", () => {
    const { contributes } = manifest();
    expect(contributes?.commands).toEqual(
      COMMANDS.map(({ id, title, keywords, description, args, agent, readOnly, irreversible }) => ({
        id,
        title,
        ...(keywords ? { keywords } : {}),
        ...(agent ? { description, ...(args ? { args } : {}), agent } : {}),
        ...(readOnly ? { readOnly } : {}),
        ...(irreversible ? { irreversible } : {}),
      })),
    );
    for (const command of COMMANDS) {
      expect(command.title).toMatch(/^Local agents: /);
      expect(command.description.length).toBeGreaterThan(10);
    }
    expect(contributes?.keys).toEqual([{ key: "Mod+Shift+A", command: "endue.local-agents.open" }]);
  });

  it("offers agents list, ask, work and add-card", () => {
    const offered = (manifest().contributes?.commands ?? []).filter((c) => c.agent);
    expect(offered.map((c) => [c.id, c.readOnly ?? false, c.irreversible ?? false])).toEqual([
      ["endue.local-agents.list", true, false],
      ["endue.local-agents.ask", true, false],
      ["endue.local-agents.work", false, true],
      ["endue.local-agents.add-card", false, false],
    ]);
    for (const command of offered) expect(command.description?.length).toBeGreaterThan(40);
    const props = (id: string) =>
      Object.keys((offered.find((c) => c.id === id)?.args?.properties ?? {}) as object);
    expect(props("endue.local-agents.ask")).toEqual(["prompt", "agent", "model", "folder"]);
    expect(props("endue.local-agents.work")).toEqual(["prompt", "agent", "model", "folder"]);
    expect(props("endue.local-agents.add-card")).not.toContain("run");
  });

  it("gives every command's args a schema a desk can compile", () => {
    const ajv = new Ajv2020({ strict: true });
    for (const { id, args } of COMMANDS)
      if (args) expect(() => ajv.compile(args), id).not.toThrow();
  });

  it("declares the settings the plugin reads, with the same defaults, ranges and choices", () => {
    const settings = manifest().contributes?.settings ?? {};
    expect(Object.keys(settings)).toEqual(SETTING_KEYS);
    expect(Object.values(settings).map((setting) => setting.default)).toEqual(
      Object.values(DEFAULTS),
    );
    expect(settings["endue.local-agents.timeout"]).toMatchObject({
      minimum: RANGES.timeout?.[0],
      maximum: RANGES.timeout?.[1],
    });
    expect(settings["endue.local-agents.parallel"]).toMatchObject({
      minimum: RANGES.parallel?.[0],
      maximum: RANGES.parallel?.[1],
    });
    expect(settings["endue.local-agents.access"]?.choices).toEqual(CHOICES.access);
    expect(settings["endue.local-agents.agent"]?.choices).toEqual(CHOICES.agent);
  });

  it("keeps every source file under 400 lines", () => {
    for (const dir of ["ui", "tests"]) {
      for (const name of readdirSync(join(folder, dir))) {
        const text = readFileSync(join(folder, dir, name), "utf8");
        const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
        expect(lines, name).toBeLessThanOrEqual(400);
      }
    }
    const readme = readFileSync(join(folder, "README.md"), "utf8").trimEnd().split("\n");
    expect(readme.length).toBeLessThanOrEqual(40);
  });
});

describe("the theme", () => {
  it("reads every colour, font, size, radius and duration from the theme", () => {
    expect(lintPlugin("local-agents")).toEqual([]);
  });
});
