import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { canonical, DESK_KEYS } from "../ui/keys.js";
import { PREFIX, SHELLS } from "../ui/shell.js";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/terminal");
const pluginSpec = join(root, "specs/plugin/v0");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
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

describe("plugin.json", () => {
  it("is a UI plugin that runs the shells in a PTY, notifies and keeps desk buffers", () => {
    const validate = manifestValidator();
    const terminal = manifest();
    expect(validate(terminal), JSON.stringify(validate.errors)).toBe(true);
    expect(terminal).toMatchObject({ id: "endue.terminal", name: "Terminal", kind: "ui" });
    expect(terminal.entry).toBe("ui/index.html");
    expect(existsSync(join(folder, terminal.entry ?? "missing"))).toBe(true);
    expect(terminal.surfaces).toEqual([{ id: "main", title: "Terminal", placement: "center" }]);
    expect(terminal.permissions).toEqual([
      { permission: "proc:spawn", commands: SHELLS, pty: true },
      { permission: "ui:notify" },
      {
        permission: "cmd:invoke",
        ids: ["desk.buffers.open", "desk.buffers.update", "desk.buffers.close"],
      },
    ]);
  });

  it("contributes its commands, keys, display rule and settings under its own id", () => {
    const { contributes } = manifest();
    const commands = (contributes?.commands ?? []).map((c) => c.id);
    expect(commands).toEqual([
      "endue.terminal.new",
      "endue.terminal.focus",
      "endue.terminal.close",
      "endue.terminal.next",
      "endue.terminal.previous",
      "endue.terminal.clear",
      "endue.terminal.interrupt",
      "endue.terminal.restart",
      "endue.terminal.run",
    ]);
    for (const key of contributes?.keys ?? []) expect(commands).toContain(key.command);
    expect(contributes?.display).toEqual([
      {
        match: { plugin: "endue.terminal" },
        area: "center",
        size: { columns: 1, rows: 1 },
        focus: true,
      },
    ]);
    for (const name of Object.keys(contributes?.settings ?? {})) {
      expect(name.startsWith(PREFIX)).toBe(true);
    }
    expect(Object.keys(contributes?.settings ?? {})).toHaveLength(13);
  });

  it("binds only keys the terminal hands to the desk, so a shell cannot swallow them", () => {
    for (const binding of manifest().contributes?.keys ?? []) {
      for (const platform of ["mac", "linux", "windows"] as const) {
        const reach = DESK_KEYS.map((chord) => canonical(chord, platform));
        expect(reach, `${binding.key} on ${platform}`).toContain(canonical(binding.key, platform));
      }
    }
  });

  it("ships the vendored emulator its page loads", () => {
    for (const file of ["xterm.mjs", "xterm.css", "addon-fit.mjs", "addon-unicode11.mjs"]) {
      expect(existsSync(join(folder, "ui/vendor", file)), file).toBe(true);
    }
    const page = readFileSync(join(folder, "ui/index.html"), "utf8");
    expect(page).toContain('"@endue-ai/plugin-sdk": "/_desk/plugin-sdk.js"');
    expect(page).toContain("./vendor/xterm.css");
  });
});
