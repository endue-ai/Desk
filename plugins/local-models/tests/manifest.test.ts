// The manifest is valid against specs/plugin/v0, connects only to this computer unless the person
// adds another, and every command it declares is one the plugin answers.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { wireCommands } from "../ui/commands.js";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/local-models");
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
  permissions: { permission: string; hosts?: string[]; commands?: string[] }[];
  contributes: { commands: { id: string }[] };
};
const manifest = readJson(join(folder, "plugin.json")) as Manifest;

describe("plugin.json", () => {
  it("is a valid manifest", () => {
    const validate = validator();
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
  });

  it("connects to this computer by itself, and is asked for another", () => {
    const connect = manifest.permissions.filter((p) => p.permission === "net:connect");
    // `*` holds no host: a server the person adds is asked for at run time (ADR 0260).
    expect(connect).toEqual([
      { permission: "net:connect", hosts: ["localhost", "127.0.0.1"] },
      { permission: "net:connect", hosts: ["*"] },
    ]);
  });

  it("answers every command it declares", () => {
    const registered: string[] = [];
    wireCommands({ commands: { on: (id: string) => registered.push(id) } }, {} as never);
    expect(registered.sort()).toEqual(manifest.contributes.commands.map(({ id }) => id).sort());
  });
});
