// The manifest is valid against specs/plugin/v0, asks only for the docker program (and the brain),
// and every command it declares is one the plugin answers.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { wireCommands } from "../ui/commands.js";
import { CONTAINER_OPERATIONS, PRUNE_ARGS } from "../ui/schemas.js";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/docker-studio");
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
  permissions: { permission: string; commands?: string[]; paths?: string[] }[];
  contributes: {
    commands: {
      id: string;
      agent?: boolean;
      readOnly?: boolean;
      irreversible?: boolean;
      args?: { properties?: Record<string, { enum?: string[]; items?: { enum?: string[] } }> };
    }[];
  };
};
const manifest = readJson(join(folder, "plugin.json")) as Manifest;

describe("plugin.json", () => {
  it("is a valid manifest", () => {
    const validate = validator();
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
  });

  it("spawns only docker, without a broad grant", () => {
    const spawn = manifest.permissions.filter((p) => p.permission === "proc:spawn");
    expect(spawn).toEqual([{ permission: "proc:spawn", commands: ["docker"] }]);
    // Files to write a Dockerfile where the person says; each use asks for that one folder, and
    // `/**` holds none (ADR 0260).
    const fs = manifest.permissions.filter((p) => p.permission.startsWith("fs:"));
    const home = ["$", "{home}/**"].join("");
    expect(fs).toEqual([
      { permission: "fs:read", paths: [home] },
      { permission: "fs:write", paths: [home] },
      { permission: "fs:read", paths: ["/**"] },
      { permission: "fs:write", paths: ["/**"] },
    ]);
  });

  it("answers every command it declares", () => {
    const registered: string[] = [];
    wireCommands({ commands: { on: (id: string) => registered.push(id) } }, {} as never);
    expect(registered.sort()).toEqual(manifest.contributes.commands.map(({ id }) => id).sort());
  });

  it("keeps command values in step with the runtime", () => {
    const properties = (name: string) =>
      manifest.contributes.commands.find(({ id }) => id === `endue.docker-studio.${name}`)?.args
        ?.properties;
    expect(properties("prune")?.kinds?.items?.enum).toEqual(Object.keys(PRUNE_ARGS));
    expect(properties("act")?.action?.enum).toEqual(CONTAINER_OPERATIONS);
    for (const op of CONTAINER_OPERATIONS) {
      expect(properties(op)).toHaveProperty("containers");
    }
  });

  it("separates read tools, ordinary controls and irreversible operations", () => {
    const groups = [
      [
        ["volumes", "networks", "image", "builds", "contexts", "search", "files", "stats"],
        true,
        false,
      ],
      [
        [
          "start",
          "stop",
          "restart",
          "pause",
          "unpause",
          "volume-create",
          "network-create",
          "network-connect",
          "tag",
          "use-context",
          "build",
          "compose-up",
        ],
        false,
        false,
      ],
      [
        ["remove", "kill", "volume-remove", "network-remove", "remove-image", "push", "prune"],
        false,
        true,
      ],
    ] as const;
    for (const [names, readOnly, irreversible] of groups) {
      for (const name of names) {
        const command = manifest.contributes.commands.find(
          (c) => c.id === `endue.docker-studio.${name}`,
        );
        expect(
          [command?.agent, command?.readOnly ?? false, command?.irreversible ?? false],
          name,
        ).toEqual([true, readOnly, irreversible]);
      }
    }
    expect(
      manifest.contributes.commands.find((c) => c.id === "endue.docker-studio.act")?.agent ?? false,
    ).toBe(false);
  });
});
