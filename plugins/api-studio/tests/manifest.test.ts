// The manifest is valid against specs/plugin/v0, spawns only curl, and every command it declares
// is one the plugin answers.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/api-studio");
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
    commands: { id: string; agent?: boolean; readOnly?: boolean; irreversible?: boolean }[];
  };
};
const manifest = readJson(join(folder, "plugin.json")) as Manifest;

describe("plugin.json", () => {
  it("is a valid manifest", () => {
    const validate = validator();
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
  });

  it("spawns curl, and may be asked for the one endue.api-studio.curl names", () => {
    const spawn = manifest.permissions.filter((p) => p.permission === "proc:spawn");
    // `*` holds no program: another curl is asked for at run time (ADR 0260).
    expect(spawn).toEqual([
      { permission: "proc:spawn", commands: ["curl"] },
      { permission: "proc:spawn", commands: ["*"] },
    ]);
  });

  it("answers every command it declares", () => {
    const sources = readdirSync(join(folder, "ui"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(join(folder, "ui", f), "utf8"))
      .join("\n");
    for (const { id } of manifest.contributes.commands) {
      expect(id.startsWith("endue.api-studio.")).toBe(true);
      const name = id.slice("endue.api-studio.".length);
      const answered = sources.includes(`"${id}"`) || sources.includes(`on("${name}",`);
      expect(answered, id).toBe(true);
    }
  });

  it("exposes only the narrow saved send without an irreversible approval", () => {
    const command = (name: string) =>
      manifest.contributes.commands.find((c) => c.id === `endue.api-studio.${name}`);
    expect(command("send")).toMatchObject({ irreversible: true });
    expect(command("run")).toMatchObject({ irreversible: true });
    expect(command("send-read")).toMatchObject({ agent: true });
    expect(command("send-read")).not.toHaveProperty("irreversible");
    for (const name of ["tab", "request", "codegen"])
      expect(command(name), name).toMatchObject({ agent: true, readOnly: true });
    for (const name of [
      "open",
      "new-request",
      "import-curl",
      "save-request",
      "use-environment",
      "set-variable",
      "import",
    ])
      expect(command(name), name).toMatchObject({ agent: true });
  });
});
