// endue.computer's manifest: a UI plugin off until the person opens it, holding computer:see and
// computer:control and nothing more, offering agents its tools (the reads read only, none marked
// irreversible: the core holds every act itself, ADR 0123), with the app list and the stop key.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { READS, TOOLS } from "../ui/tools.js";

const root = join(import.meta.dirname, "../../..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const manifest = readJson(join(root, "plugins/computer/plugin.json")) as PluginManifest;

function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const spec of ["plugin/v0", "item/v0", "view/v0", "connector/v0", "memory/v0"]) {
    const dir = join(root, "specs", spec);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(readJson(join(dir, name)) as object);
  }
  const validate = ajv.getSchema("https://endue.ai/specs/plugin/v0/plugin.schema.json");
  if (!validate) throw new Error("cannot compile plugin.schema.json");
  return validate;
}

describe("plugin.json", () => {
  it("is a UI plugin with a centre page, off until the person opens it", () => {
    const validate = manifestValidator();
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest).toMatchObject({ id: "endue.computer", kind: "ui", autoload: true });
    expect(manifest.description?.length ?? 0).toBeLessThan(250);
  });

  it("asks for computer:see and computer:control, and nothing more", () => {
    expect(manifest.permissions).toEqual([
      { permission: "computer:see" },
      { permission: "computer:control" },
    ]);
  });

  it("offers agents every tool, the reads read only and no act irreversible", () => {
    const commands = manifest.contributes?.commands ?? [];
    for (const id of TOOLS) {
      const command = commands.find((c) => c.id === id);
      expect(command, id).toBeDefined();
      expect(command?.agent, id).toBe(true);
      expect(command?.description?.length ?? 0, id).toBeGreaterThan(40);
      expect(command?.readOnly === true, id).toBe(READS.has(id));
      expect(command?.irreversible, id).toBeUndefined();
      const ajv = new Ajv2020({ strict: true });
      expect(() => ajv.compile(command?.args as object), id).not.toThrow();
    }
  });

  it("declares the app list and the stop key", () => {
    const settings = manifest.contributes?.settings ?? {};
    expect(settings["endue.computer.apps"]).toMatchObject({ kind: "array", default: [] });
    expect(settings["endue.computer.stop-key"]).toMatchObject({
      kind: "string",
      default: "Escape",
    });
  });
});
