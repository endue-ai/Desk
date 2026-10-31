import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { COMMANDS } from "../ui/schemas.js";
import { DEFAULTS, SETTING_KEYS } from "../ui/settings.js";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/docker");
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
  it("is a UI plugin that runs only the docker program and opens one center surface", () => {
    // The manifest references the item, view and connector specs, which reference it back.
    const validate = validator("https://endue.ai/specs/plugin/v0/plugin.schema.json", [
      "plugin/v0",
      "item/v0",
      "view/v0",
      "connector/v0",
    ]);
    const docker = manifest();
    expect(validate(docker), JSON.stringify(validate.errors)).toBe(true);
    expect(existsSync(join(folder, docker.entry ?? "missing"))).toBe(true);
    expect(docker).toMatchObject({ id: "endue.docker", name: "Docker", kind: "ui" });
    expect(docker.surfaces).toEqual([{ id: "main", title: "Docker", placement: "center" }]);
    expect(docker.permissions).toEqual([
      { permission: "proc:spawn", commands: ["docker"] },
      {
        permission: "cmd:invoke",
        ids: [
          "desk.palette.pick",
          "desk.buffers.open",
          "desk.buffers.update",
          "desk.files.open",
          "endue.terminal.run",
        ],
      },
      { permission: "ui:notify" },
    ]);
  });

  it("contributes the commands the plugin registers, with the same titles and keywords", () => {
    const { contributes } = manifest();
    expect(contributes?.commands).toEqual(
      COMMANDS.map(({ id, title, keywords }) => ({ id, title, ...(keywords ? { keywords } : {}) })),
    );
    for (const command of COMMANDS) {
      expect(command.title).toMatch(/^Docker: /);
      expect(command.description.length).toBeGreaterThan(10);
    }
    expect(contributes?.keys).toEqual([{ key: "Mod+Shift+K", command: "endue.docker.open" }]);
  });

  it("gives every command's args a schema a desk can compile", () => {
    const ajv = new Ajv2020({ strict: true });
    for (const { id, args } of COMMANDS)
      if (args) expect(() => ajv.compile(args), id).not.toThrow();
  });

  it("declares the settings the plugin reads, with the same defaults", () => {
    const settings = manifest().contributes?.settings ?? {};
    expect(Object.keys(settings)).toEqual(SETTING_KEYS);
    const defaults = Object.values(DEFAULTS);
    expect(Object.values(settings).map((setting) => setting.default)).toEqual(defaults);
  });

  it("keeps every source file under 400 lines", () => {
    for (const dir of ["ui", "tests"]) {
      for (const name of readdirSync(join(folder, dir))) {
        const text = readFileSync(join(folder, dir, name), "utf8");
        const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
        expect(lines, name).toBeLessThanOrEqual(400);
      }
    }
  });
});
