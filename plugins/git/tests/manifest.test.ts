import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/git");
const pluginSpec = join(root, "specs/plugin/v0");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const name of readdirSync(pluginSpec)
    .filter((n) => n.endsWith(".schema.json"))
    .sort()) {
    ajv.addSchema(readJson(join(pluginSpec, name)) as object);
  }
  const validate = ajv.getSchema("https://endue.ai/specs/plugin/v0/plugin.schema.json");
  if (!validate) throw new Error("cannot compile plugin.schema.json");
  return validate;
}

const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;

const COMMANDS = [
  "status",
  "refresh",
  "stage",
  "unstage",
  "discard",
  "commit",
  "log",
  "diff",
  "fetch",
  "pull",
  "push",
  "checkout",
  "visit",
  "cancel",
].map((name) => `endue.git.${name}`);

describe("plugin.json", () => {
  it("is a UI plugin that runs only the git program and opens one center surface", () => {
    const validate = manifestValidator();
    const git = manifest();
    expect(validate(git), JSON.stringify(validate.errors)).toBe(true);
    expect(git.entry).toBe("ui/index.html");
    expect(existsSync(join(folder, git.entry ?? "missing"))).toBe(true);
    expect(git).toMatchObject({ id: "endue.git", name: "Git", kind: "ui" });
    expect(git.surfaces).toEqual([{ id: "main", title: "Git", placement: "center" }]);
    expect(git.permissions).toEqual([
      { permission: "proc:spawn", commands: ["git"] },
      {
        permission: "cmd:invoke",
        ids: ["desk.files.open", "desk.palette.pick", "desk.buffers.open", "desk.buffers.update"],
      },
    ]);
  });

  it("contributes every operation as a command, one key and its settings", () => {
    const { contributes } = manifest();
    expect(contributes?.commands?.map((c) => c.id)).toEqual(COMMANDS);
    for (const command of contributes?.commands ?? []) expect(command.title).toMatch(/^Git: /);
    expect(contributes?.keys).toEqual([{ key: "Mod+Shift+G", command: "endue.git.status" }]);
    expect(Object.keys(contributes?.settings ?? {})).toEqual([
      "endue.git.log-count",
      "endue.git.diff-context",
      "endue.git.sign-off",
      "endue.git.pull-rebase",
      "endue.git.confirm",
      "endue.git.recent-max",
    ]);
    expect(contributes?.settings?.["endue.git.confirm"]).toMatchObject({
      kind: "boolean",
      default: true,
    });
  });

  it("keeps every source file under 400 lines", () => {
    const ui = join(folder, "ui");
    for (const name of readdirSync(ui)) {
      const text = readFileSync(join(ui, name), "utf8");
      const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
      expect(lines, name).toBeLessThanOrEqual(400);
    }
  });
});
