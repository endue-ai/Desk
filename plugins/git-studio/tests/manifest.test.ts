// The manifest is valid against specs/plugin/v0, asks only for the git program (and the brain),
// and every command it declares is one the plugin answers.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/git-studio");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function validator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const spec of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
    const dir = join(root, "specs", spec);
    for (const name of readdirSync(dir)
      .filter((f) => f.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(readJson(join(dir, name)) as object);
  }
  const validate = ajv.getSchema("https://endue.ai/specs/plugin/v0/plugin.schema.json");
  if (!validate) throw new Error("cannot compile plugin.schema.json");
  return validate;
}

type Manifest = {
  id: string;
  permissions: { permission: string; commands?: string[] }[];
  contributes: {
    commands: {
      id: string;
      description?: string;
      agent?: boolean;
      readOnly?: boolean;
      irreversible?: boolean;
    }[];
  };
};
const manifest = readJson(join(folder, "plugin.json")) as Manifest;

describe("plugin.json", () => {
  it("is a valid manifest", () => {
    const validate = validator();
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
  });

  it("spawns only git, without a broad grant", () => {
    const spawn = manifest.permissions.filter((p) => p.permission === "proc:spawn");
    expect(spawn).toEqual([{ permission: "proc:spawn", commands: ["git"] }]);
    expect(
      manifest.permissions.map((p) => p.permission).filter((p) => p.startsWith("fs:")),
    ).toEqual([]);
  });

  it("answers every command it declares", () => {
    const sources = readdirSync(join(folder, "ui"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(join(folder, "ui", f), "utf8"))
      .join("\n");
    for (const { id } of manifest.contributes.commands) {
      expect(id.startsWith("endue.git-studio.")).toBe(true);
      // commands.js registers on("<name>", …) under the plugin's prefix; studio.js the full id.
      const name = id.slice("endue.git-studio.".length);
      const answered = sources.includes(`"${id}"`) || sources.includes(`on("${name}",`);
      expect(answered, id).toBe(true);
    }
  });

  it("exposes Studio tools and holds the commands that may publish or remove work", () => {
    const command = (name: string) =>
      manifest.contributes.commands.find(({ id }) => id === `endue.git-studio.${name}`);
    for (const name of ["diff", "show", "blame-data", "file-log"]) {
      expect(command(name), name).toMatchObject({ agent: true, readOnly: true });
    }
    for (const name of [
      "push",
      "discard",
      "delete-branch",
      "drop-stash",
      "reset-hard",
      "proceed",
    ]) {
      expect(command(name), name).toMatchObject({ agent: true, irreversible: true });
    }
    for (const name of [
      "open",
      "history",
      "blame",
      "graph",
      "search",
      "unstage",
      "stash",
      "stash-apply",
      "merge",
      "rebase",
      "cherry-pick",
      "revert",
      "tag",
      "rename-branch",
      "reset",
      "set-upstream",
      "undo",
    ]) {
      expect(command(name), name).toMatchObject({
        agent: true,
        description: expect.any(String),
      });
    }
    expect(command("reset")).not.toHaveProperty("irreversible");
  });
});
